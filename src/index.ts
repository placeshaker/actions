import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, Deployment, DeploymentOptions} from 'now-client'
import signale from 'signale'

const zeitToken = core.getInput('nowToken')
const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('appName')
const prod = !['', '0', 'false'].includes(core.getInput('prod'))
const aliases = core.getInput('alias')
const githubToken = core.getInput('github_token')


const octokit = new github.GitHub(githubToken, {
  previews: [
      'mercy-preview',
      'flash-preview',
      'ant-man-preview'
  ],
})

signale.success('Prod?', core.getInput('prod'), githubToken)
const context = github.context

enum GithubDeploymentStatus {
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
}

const nowJsonOptions = {
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
}

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
    signale.debug('Creating github deployment with data', payload)

    const {data} = await octokit.repos.createDeployment({
      environment: payload.target,
      // @ts-ignore
      ref: context.ref,
      repo: context.repo.repo,
      owner: context.repo.owner,
      payload: JSON.stringify(payload)
    })
    signale.success('Created deployment', data)
    return data;
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
  signale.debug('Starting now deployment with data', deploymentOptions, nowJsonOptions)

  let githubDeployment: any

  const appPath = path.resolve(process.cwd(), app)

  for await (const event of createDeployment(appPath, deploymentOptions, nowJsonOptions)) {
    const {payload, type} = event
    try {
      if (event.type !== 'hashes-calculated') {
        signale.debug('Received event ' + event.type, event)
      }
      if (type === 'created') {
        githubDeployment = await createGithubDeployment(payload)
      } else {
        let state: string = GithubDeploymentStatus.PENDING.toLowerCase()
        switch (payload.readyState) {
          case 'DEPLOYING':
            state = GithubDeploymentStatus.IN_PROGRESS.toLowerCase()
            break
          case 'ERROR':
            state = GithubDeploymentStatus.ERROR.toLowerCase()
            break
          case 'READY':
            state = GithubDeploymentStatus.SUCCESS.toLowerCase()
            core.setOutput('previewUrl', payload.url)
            break

          default:
            break
        }

        if (githubDeployment) {
          await updateDeploymentStatus(githubDeployment.id, state, payload.target, payload.url ? `https://${payload.url}`: undefined, payload.alias && payload.alias[0] ? `https://${payload.alias[0]}`: undefined)
        }
      }
    } catch (e) {
      signale.fatal('Received error', e)
      await updateDeploymentStatus(
        githubDeployment.id,
        GithubDeploymentStatus.FAILURE,
        payload.target,
        payload.deploymentId,
        payload.url,
      )

      throw e
    }
  }
}

deploy().catch(error => {
  signale.fatal(error)
  core.setFailed(error.message)
})
