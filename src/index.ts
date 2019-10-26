import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createDeployment, Deployment, DeploymentOptions} from 'now-client'
import signale from 'signale'

const zeitToken = core.getInput('nowToken')
const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('appName')
const prod = Boolean(core.getInput('prod'))
const aliases = core.getInput('alias');
const githubToken = core.getInput('githubToken')

const octokit = new github.GitHub(githubToken)

const context = github.context

signale.debug(github, context, process.cwd())

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
  alias: prod ? aliases : [],
  meta: {
    name: `pr-${context.payload.number}`,
    githubCommitSha: context.sha,
    githubCommitAuthorName: context.actor,
    githubCommitAuthorLogin: context.actor,
    githubDeployment: 1,
    githubOrg: context.repo.owner,
    githubRepo: context.repo.repo,
    githubCommitOrg: context.repo.owner,
    githubCommitRepo: context.repo.repo,
    pr: context.payload.number,
  },
  github: {
    enabled: true,
    autoAlias: true,
    silent: false,
    autoJobCancelation: true,
  },
}

const deploymentOptions: DeploymentOptions = {
  version: 2,
  name: appName,
  regions: ['bru1'],
  builds: [
    {
      src: 'package.json',
      use: '@now/next'
    },
  ],
  target: prod ? 'production' : 'staging',
  token: zeitToken,
  teamId: 'placeshaker',
  force: true,
  isDirectory: true,
  path: app ? path.join(process.cwd(), app) : undefined,
  scope,
  public: false,
  debug: true
}

const createGithubDeployment = async (payload: Deployment): Promise<void> => {
  const variables = {
    owner: context.repo.owner,
    name: context.repo.repo,
    pr: context.payload.number,
  }

  signale.debug('Consulting repo information with variables', variables)
  const {data: repoData} = await octokit.graphql(
    `
    query($owner: String!, $name: String!, $pr: Int!){
      repository(owner: $owner, name: $name) {
        id
        pullRequest(number: $pr) {
          id
        }
      }
    }
    `,
    variables,
  )

  signale.success('Got repo data', repoData)

  const input = {
    // The node ID of the repository.
    repositoryId: repoData.id,

    // The node ID of the ref to be deployed.
    refId: repoData.pullRequest.id,

    // Attempt to automatically merge the default branch into the requested ref, defaults to true.
    autoMerge: false,

    // The status contexts to verify against commit status checks.
    // To bypass required contexts, pass an empty array.Defaults to all unique contexts.
    requiredContexts: [],

    // Short description of the deployment.
    description: context.payload.head_commit.message,

    // Name for the target deployment environment.
    environment: payload.target,

    // Specifies a task to execute.
    task: 'deploy',

    // JSON payload with extra information about the deployment.
    payload: JSON.stringify(payload),

    clientMutationId: String,
  }
  try {
    signale.debug('Creating github deployment with data', input)
    const {data} = await octokit.graphql(
      `
      mutation ($input: CreateDeploymentInput){
        createDeployment(input: $input) {
          deployment {
            id
            latestStatus {
              environmentUrl
            }
          }
        }
      }
      `,
      input,
    )
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
    const {data: status} = await octokit.graphql(
      `
    mutation ($input: CreateDeploymentStatusInput!) {
      createDeploymentStatus(input: $input) {
        deploymentStatus {
          state
          logUrl
          environment
          environmentUrl
        }
      }
    }
    `,
      {
        input,
      },
    )

    return status
  } catch (e) {
    signale.fatal('Error while updating repo state', e)
  }
}

/**
 * Start deploying
 */
const deploy = async (): Promise<void> => {
  signale.debug('Starting now deployment with data', deploymentOptions)

  let githubDeployment: any

  const appPath = path.resolve(process.cwd(), app);

  for await (const event of createDeployment(appPath, deploymentOptions, nowJsonOptions)) {
    const {payload, type} = event
    try {
      if(event.type !== 'hashes-calculated') {
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
  core.setFailed(error.message)
})
