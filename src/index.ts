import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, Deployment, DeploymentOptions, NowJsonOptions} from 'now-client'
import signale from 'signale'
import * as fs from 'fs'

const zeitToken = core.getInput('now_token')
const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('app_name')
const prod = !['', '0', 'false'].includes(core.getInput('prod'))
const alias = core.getInput('alias')
const debug = ['1', '0', 'true', 'false', true, false].includes(core.getInput('debug'))
  ? Boolean(core.getInput('debug'))
  : false
const githubToken = core.getInput('github_token')

const octokit = new github.GitHub(githubToken, {
  previews: ['mercy-preview', 'flash-preview', 'ant-man-preview'],
})

const context = github.context

const overrideNowJson = {
  name: appName,
  scope,
  alias: alias.split(','),
}

const defaultJsonOptions = {
  meta: {
    name: `pr-${context.payload.number}`,
    githubCommitSha: context.sha,
    githubCommitAuthorName: context.actor,
    githubCommitAuthorLogin: context.actor,
    githubDeployment: '1',
    githubOrg: context.repo.owner,
    githubRepo: context.repo.repo,
    githubCommitOrg: context.repo.owner,
    githubCommitRepo: context.repo.repo,
    pr: `${context.payload.number}`,
  },
  github: {
    enabled: true,
    autoAlias: true,
    silent: false,
    autoJobCancelation: true,
  },
  build: {
    env: {},
  },
  public: false,
}

const createGithubDeployment = async (payload: Deployment): Promise<any> => {
  try {
    signale.debug('Creating github deployment')

    const {data} = await octokit.repos.createDeployment({
      environment: payload.target,
      task: 'deploy',
      ref: context.payload.pull_request && context.payload.pull_request.head ? context.payload.pull_request.head.ref : context.ref,
      repo: context.repo.repo,
      owner: context.repo.owner,
      payload: JSON.stringify(payload),
      description: `Deploying ${appName} to ${payload.target}`,
      production_environment: prod || payload.target === 'production',
    })
    signale.success('Created deployment', data)
    return data
  } catch (e) {
    signale.fatal('Error creating deployment', e)
  }
}

const updateDeploymentStatus = async (
  deploymentId: number,
  state: any,
  environment: any,
  logUrl?: string,
  environmentUrl?: string,
): Promise<any> => {
  try {
    const {data} = await octokit.repos.createDeploymentStatus({
      owner: context.repo.owner,
      repo: context.repo.repo,
      deployment_id: deploymentId,
      log_url: logUrl,
      environment,
      environment_url: environmentUrl,
      state,
    })
    signale.success('Updated deployment status to', state)
    return data
  } catch (e) {
    signale.fatal('Error while updating repo state', e)
    throw e
  }
}

const resolveEnvVariables = async (requiredKeys: string[]): Promise<{[key: string]: string}> => {
  const env: {[key: string]: string} = {}
  const missing: string[] = []

  requiredKeys.forEach(key => {
    if (!process.env[key]) {
      signale.fatal(
        `${key} must be passed to the action as environment variable, seems like it's not the case. This will break deployment.`,
      )
      missing.push(key)
    } else {
      env[key] = process.env[key] || ''
    }
  })

  if (missing.length > 0) {
    throw new Error(
      `Missing env variables block the deployment. \n Check your configuration and declare the variables: \n${missing.join(
        '\n',
      )} `,
    )
  }

  return env
}

/**
 * Start deploying
 */
const deploy = async (): Promise<void> => {
  const deploymentOptions: DeploymentOptions = {
    version: 2,
    name: appName,
    regions: ['bru1'],
    builds: [
      {
        src: 'package.json',
        use: '@now/next',
      },
    ],
    target: prod ? 'production' : 'staging',
    token: zeitToken,
    force: true,
    debug,
  }
  signale.debug('Starting now deployment with data')

  const appPath = path.resolve(process.cwd(), app)
  const jsonConfigFile = path.join(appPath, 'now.json')

  signale.debug('Trying to read now.json')

  let finalConfig: NowJsonOptions = Object.assign(defaultJsonOptions, overrideNowJson)

  if (fs.existsSync(jsonConfigFile)) {
    signale.debug('now.json exists, trying to read...')
    let jsonContent: any
    try {
      jsonContent = JSON.parse(fs.readFileSync(jsonConfigFile, {encoding: 'utf8'}))
    } catch (e) {
      signale.fatal('Unable to read now.json, keep going anyway...')
    }

    if (jsonContent) {
      const env = await resolveEnvVariables(Object.keys(jsonContent.build.env))

      deploymentOptions.build = {
        env,
      }

      deploymentOptions.env = env

      signale.debug(JSON.stringify(jsonContent, null, 2))
      finalConfig = Object.assign(defaultJsonOptions, jsonContent, overrideNowJson)
    }
  }

  let deployment: any

  for await (const event of createDeployment(appPath, deploymentOptions, finalConfig)) {
    const {payload, type} = event
    try {
      if (event.type !== 'hashes-calculated') {
        signale.debug('Received event ' + event.type)
        signale.debug(event.payload)
      }

      if (type === 'created') {
        deployment = await createGithubDeployment(payload)
      }

      if (deployment) {
        if (type === 'error') {
          await updateDeploymentStatus(
            deployment.id,
            'error',
            payload.target,
            payload.url ? `https://${payload.url}` : undefined,
            payload.alias && payload.alias[0] ? `https://${payload.alias[0]}` : undefined,
          )
        } else if (type === 'ready') {
          await updateDeploymentStatus(
            deployment.id,
            'success',
            payload.target,
            payload.url ? `https://${payload.url}` : undefined,
            payload.alias && payload.alias[0] ? `https://${payload.alias[0]}` : undefined,
          )
          core.setOutput('environment-url', payload.alias && payload.alias[0] ? `https://${payload.alias[0]}` : '')
          core.setOutput('log-url', payload.url ? `https://${payload.url}` : payload.url)
          core.setOutput('deployment-id', deployment.id)
        }
      }
    } catch (e) {
      signale.fatal('Received error', e)

      throw e
    }
  }

  signale.debug('Getting logs from deployment')
}

deploy().catch(error => {
  signale.fatal(error)
  core.setFailed(error.message)
})
