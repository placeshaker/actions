import {GitHub} from '@actions/github/lib/github'

type RepoInformationVariables = {
  owner: string
  name: string
  pr: number
}

export type CreateDeploymentInput = {
  // The node ID of the repository.
  repositoryId: string

  // The node ID of the ref to be deployed.
  refId: string

  // Attempt to automatically merge the default branch into the requested ref, defaults to true.
  autoMerge: boolean

  // The status contexts to verify against commit status checks.
  // To bypass required contexts, pass an empty array.Defaults to all unique contexts.
  requiredContexts: Array<string>

  // Short description of the deployment.
  description: string

  // Name for the target deployment environment.
  environment: string

  // Specifies a task to execute.
  task: string

  // JSON payload with extra information about the deployment.
  payload: string
}

export type UpdateDeploymentInput = {
  deploymentId: string
  state: string
  environment: string
  logUrl?: string
  environmentUrl?: string
}

export const getRepoInformation = async (octokit: GitHub, variables: RepoInformationVariables): Promise<any> => {
  const {data} = await octokit.graphql(
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

  return data
}

/**
 * Create a github deployment
 * @param octokit
 * @param variables
 */
export const createGHDeployment = async (octokit: GitHub, variables: CreateDeploymentInput): Promise<any> => {
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
    variables,
  )

  return data
}

/**
 *
 * @param octokit
 * @param variables
 */
export const updateGHDeploymentStatus = async (octokit: GitHub, variables: UpdateDeploymentInput): Promise<any> => {
  const {data} = await octokit.graphql(
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
      input: variables,
    },
  )

  return data
}
