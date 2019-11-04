import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, DeploymentOptions, NowJsonOptions} from 'now-client'
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
    ref: context.ref,
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

  for await (const event of createDeployment(appPath, deploymentOptions, finalConfig)) {
    const {payload, type} = event
    try {
      signale.debug('Received event ' + event.type)

      if (type === 'error' || type === 'ready') {
        core.setOutput('environment-url', payload.alias && payload.alias[0] ? `https://${payload.alias[0]}` : '')
        core.setOutput('log-url', payload.url ? `https://${payload.url}` : payload.url)
        core.setOutput('deployment-id', payload.id)
        core.setOutput('app', scope)
        core.setOutput('payload', payload)
      }

      if (type === 'error') {
        throw new Error(`Deployment fails with error`)
      }
    } catch (e) {
      signale.fatal('Received error', e)

      throw e
    }
  }
}

deploy().catch(error => {
  signale.fatal(error)
  core.setFailed(error.message)
})
