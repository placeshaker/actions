import * as path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
// @ts-ignore
import * as client from 'firebase-tools'
import {createDeployment, Deployment, DeploymentOptions, NowJsonOptions} from 'now-client'
import signale from 'signale'
import * as fs from 'fs'
import {toEnvFormat} from "./utils.js";

const zeitToken = core.getInput('now_token')
const scope = core.getInput('scope')
const app = core.getInput('app')
const appName = core.getInput('app_name')
const prod = !['', '0', 'false'].includes(core.getInput('prod'))
const alias = core.getInput('alias')
const debug = ['1', '0', 'true','false', true, false].includes(core.getInput('debug')) ? Boolean(core.getInput('debug')) : false
const githubToken = core.getInput('github_token')
const firebaseToken = core.getInput('firebase_token')
const firebaseProject = core.getInput('firebase_project')

const octokit = new github.GitHub(githubToken, {
  previews: ['mercy-preview', 'flash-preview', 'ant-man-preview'],
})


const context = github.context

if(debug)
  signale.success(JSON.stringify(context.payload, null, 2))

const overrideNowJson = {
  name: appName,
  scope,
  alias: alias.split(',')
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
    // @ts-ignore
    ref: context.head_ref
  },
  github: {
    enabled: true,
    autoAlias: true,
    silent: false,
    autoJobCancelation: true,
  },
  build: {
    env: {}
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
  debug,
}

const createGithubDeployment = async (payload: Deployment): Promise<any> => {
  try {
    signale.debug('Creating github deployment')

    const {data} = await octokit.repos.createDeployment({
      environment: payload.target,
      task: 'deploy',
      // @ts-ignore
      ref: context.payload.pull_request.head.ref || context.ref,
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


const resolveEnvVariables = async (requiredKeys: string[]) => {

  const env: {[key:string]: string } = {}

  const fbConfig = await client.setup.web({
    project: firebaseProject,
    token: firebaseToken || process.env.FIREBASE_TOKEN,
  });

  signale.success('Resolved firebase config', fbConfig)

  Object.keys(fbConfig).forEach(key => {
    // @ts-ignore
    env[`FIREBASE_${toEnvFormat(key)}`] = fbConfig[key];
  });


  signale.debug(env)

  let missing: string[] = [];

  requiredKeys.forEach((key) => {
    if(process.env.hasOwnProperty(key)) {
      signale.fatal(`${key} must be passed to the action as environment variable, seems like it's not the case. This will break deployment.`)
      missing.push(key);
    }else {
      env[key] = process.env[key] || ''
    }
  })


  if(missing.length > 0) {
    throw new Error(`Missing env variables block the deployment. \n Check your configuration and declare the variables: \n${missing.join('\n')} `)
  }

  return env;

}

/**
 * Start deploying
 */
const deploy = async (): Promise<void> => {
  signale.debug('Starting now deployment with data', deploymentOptions)

  const appPath = path.resolve(process.cwd(), app)
  const jsonConfigFile = path.join(appPath, 'now.json')

  signale.debug('Trying to read now.json', jsonConfigFile)

  let finalConfig: NowJsonOptions = Object.assign(
    defaultJsonOptions,
    overrideNowJson
  );

  if(fs.existsSync(jsonConfigFile)) {
    signale.debug('now.json exists, trying to read...')
    try {
      const jsonContent = fs.readFileSync(jsonConfigFile, { encoding: 'utf8'})
      if(jsonContent) {
        signale.debug('trying to parse ....', JSON.stringify(jsonContent))
        let conf = JSON.parse(jsonContent)

        const env = await resolveEnvVariables(Object.keys(conf.build.env))

        deploymentOptions.build = {
          env
        }

        signale.debug(JSON.stringify(conf, null, 2))
        finalConfig = Object.assign(defaultJsonOptions, conf, overrideNowJson)
      }
    }catch(e) {
      signale.fatal("Unable to read now.json, keep going anyway...")
    }

  }

  console.log(JSON.stringify(finalConfig, null, 2))

  let deployment: any;

  for await (const event of createDeployment(appPath, deploymentOptions, finalConfig)) {
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
