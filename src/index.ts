import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, Deployment, DeploymentOptions} from 'now-client'
import signale from 'signale'
import {CreateDeploymentInput, createGHDeployment, getRepoInformation, updateGHDeploymentStatus} from './utils'

signale.success(process.env)

const zeitToken = core.getInput('nowToken')
const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('appName')
const prod = !['', '0', 'false'].includes(core.getInput('prod'))
const aliases = core.getInput('alias')
const githubToken = core.getInput('github_token')

const octokit = new github.GitHub(githubToken)

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

const createGithubDeployment = async (payload: Deployment): Promise<void> => {
  const variables = {
    owner: context.repo.owner,
    name: context.repo.repo,
    pr: context.payload.number,
  }

  signale.debug('Consulting repo information with variables', variables)
  const repoData = await getRepoInformation(octokit, variables)

  signale.success('Got repo data', repoData)

  const input: CreateDeploymentInput = {
    repositoryId: repoData.id,
    refId: repoData.pullRequest.id,
    autoMerge: false,
    requiredContexts: [],
    description: context.payload.head_commit.message,
    environment: payload.target,
    task: 'deploy',
    payload: JSON.stringify(payload),
  }
  try {
    signale.debug('Creating github deployment with data', input, nowJsonOptions)
    const data = await createGHDeployment(octokit, input)
    signale.success('Created deployment', data)
    return data
  } catch (e) {
    signale.fatal('Error creating deployment', e)
  }
}

const updateDeploymentStatus = async (
  deploymentId: string,
  state: string,
  environment: string,
  logUrl?: string,
  environmentUrl?: string,
): Promise<void> => {
  const input = {
    deploymentId,
    state,
    environment,
    logUrl,
    environmentUrl,
  }

  signale.debug('Updating github deployment state', deploymentId, state, environment, logUrl, environmentUrl)
  try {
    return await updateGHDeploymentStatus(octokit, input)
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
        let state: string = GithubDeploymentStatus.INACTIVE
        switch (payload.readyState) {
          case 'DEPLOYING':
            state = GithubDeploymentStatus.IN_PROGRESS
            break
          case 'ERROR':
            state = GithubDeploymentStatus.ERROR
            break
          case 'READY':
            state = GithubDeploymentStatus.SUCCESS
            core.setOutput('previewUrl', payload.url)
            break

          default:
            break
        }

        if (githubDeployment) {
          await updateDeploymentStatus(githubDeployment.id, state, payload.target, payload.deploymentId, payload.url)
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
