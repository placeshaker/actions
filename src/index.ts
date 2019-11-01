import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, Deployment, DeploymentOptions} from 'now-client'
import signale from 'signale'

const zeitToken = core.getInput('now_token')
// const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('app_name')
const prod = !['', '0', 'false'].includes(core.getInput('prod'))
// const aliases = core.getInput('alias')
const githubToken = core.getInput('github_token')

const octokit = new github.GitHub(githubToken, {
  previews: ['mercy-preview', 'flash-preview', 'ant-man-preview'],
})

const context = github.context

signale.success(context)

/*enum GithubDeploymentStatus {
  // The deployment is pending.
  PENDING = 'PENDING',

  // The deployment was successful.
  SUCCESS = 'SUCCESS',

  // The deployment has failed.
  FAILURE = 'FAILURE',

  // The deployment is inactive.
  INACTIVE = 'INACTIVE',

  // The deployment experienced an error.
  ERROR = 'ERROR',
  // The deployment is queued
  QUEUED = 'QUEUED',

  // The deployment is in progress.
  IN_PROGRESS = 'IN_PROGRESS',
}*/

/*const nowJsonOptions = {
  alias: prod ? [aliases] : [],
  scope,
  name: appName,
  meta: {
    name: `pr-${context.payload.number || 'test'}`,
    githubCommitSha: context.sha || 'test',
    githubCommitAuthorName: context.actor || 'test',
    githubCommitAuthorLogin: context.actor || 'test',
    githubDeployment: '1',
    githubOrg: context.repo.owner || 'test',
    githubRepo: context.repo.repo || 'test',
    githubCommitOrg: context.repo.owner || 'test',
    githubCommitRepo: context.repo.repo || 'test',
    pr: `${context.payload.number || 1}`,
  },
  github: {
    enabled: true,
    autoAlias: true,
    silent: false,
    autoJobCancelation: true,
  },
  public: false,
}*/

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
  debug: true,
}

const createGithubDeployment = async (payload: Deployment): Promise<any> => {
  try {
    signale.debug('Creating github deployment')

    const {data} = await octokit.repos.createDeployment({
      environment: payload.target,
      task: 'deploy',
      // @ts-ignore
      ref: context.head_ref || context.ref,
      repo: context.repo.repo,
      owner: context.repo.owner,
      payload: JSON.stringify(payload),
      description: `Deploying ${appName} to ${payload.target}`,
      production_environment: prod || payload.target === 'production'
    })
    signale.success('Created deployment', data)
    return data
  } catch (e) {
    signale.fatal('Error creating deployment', e)
  }
}

const updateDeploymentStatus = async (
  deployment_id: number,
  state: any,
  environment: any,
  log_url?: string,
  environment_url?: string,
): Promise<any> => {
  try {
    const {data} = await octokit.repos.createDeploymentStatus({
      owner: context.repo.owner,
      repo: context.repo.repo,
      deployment_id,
      log_url,
      environment,
      environment_url,
      state,
    })
    signale.success('Updated deployment status to', state)
    return data
  } catch (e) {
    signale.fatal('Error while updating repo state', e)
    throw e
  }
}

/**
 * Start deploying
 */
const deploy = async (): Promise<void> => {
  signale.debug('Starting now deployment with data', deploymentOptions)

  const appPath = path.resolve(process.cwd(), app)
  let deployment: any;

  for await (const event of createDeployment(appPath, deploymentOptions)) {
    const {payload, type} = event
    try {
      if (event.type !== 'hashes-calculated') {
        signale.debug('Received event ' + event.type)
        signale.debug(event.payload)
      }

      if(type === 'created') {
        deployment = await createGithubDeployment(payload)
      }

      if(deployment) {

        if (type === 'error') {
          await updateDeploymentStatus(
              deployment.id,
              'error',
              payload.target,
              payload.url ? `https://${payload.url}` : undefined,
              payload.alias && payload.alias[0] ? `https://${payload.alias[0]}` : undefined,
          )
        }

        else if (type === 'ready') {
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
