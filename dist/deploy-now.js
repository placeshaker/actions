"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const now_client_1 = require("now-client");
const path = __importStar(require("path"));
const zeitToken = core.getInput('nowToken');
const scope = core.getInput('scope');
const app = core.getInput('package');
const appName = core.getInput('app');
const prod = core.getInput('prod');
const githubToken = core.getInput('githubToken');
const octokit = new github.GitHub(githubToken);
const context = github.context;
var GithubDeploymentStatus;
(function (GithubDeploymentStatus) {
    // The deployment is pending.
    GithubDeploymentStatus["PENDING"] = "PENDING";
    // The deployment was successful.
    GithubDeploymentStatus["SUCCESS"] = "SUCCESS";
    // The deployment has failed.
    GithubDeploymentStatus["FAILURE"] = "FAILURE";
    // The deployment is inactive.
    GithubDeploymentStatus["INACTIVE"] = "INACTIVE";
    // The deployment experienced an error.
    GithubDeploymentStatus["ERROR"] = "ERROR";
    // The deployment is queued
    GithubDeploymentStatus["QUEUED"] = "QUEUED";
    // The deployment is in progress.
    GithubDeploymentStatus["IN_PROGRESS"] = "IN_PROGRESS";
})(GithubDeploymentStatus || (GithubDeploymentStatus = {}));
const appPath = path.resolve(app);
if (!fs.existsSync(app)) {
    throw new Error(`App path is invalid: ${appPath}`);
}
else {
    process.chdir(appPath);
}
const deploymentOptions = {
    version: 2,
    name: appName,
    alias: [],
    regions: ['bru1'],
    builds: [
        {
            src: 'package.json',
            use: '@now/next',
            config: {
                '--prefer-offline': false,
            },
        },
    ],
    target: prod ? 'production' : 'staging',
    token: zeitToken,
    teamId: 'placeshaker',
    force: true,
    isDirectory: true,
    path: '.',
    github: {
        enabled: true,
        autoAlias: true,
        silent: false,
        autoJobCancelation: true,
    },
    scope,
    public: false,
    debug: true,
    meta: {
        githubCommitSha: context.sha,
        githubCommitAuthorName: context.actor,
        githubCommitAuthorLogin: context.actor,
        githubDeployment: 1,
        githubOrg: context.repo.owner,
        githubRepo: context.repo.repo,
        githubCommitOrg: context.repo.owner,
        githubCommitRepo: context.repo.repo,
        githubCommitMessage: context.payload.head_commit.message,
    },
};
const createGithubDeployment = async (payload) => {
    const { data: repoData } = await octokit.graphql(`
    query($owner: String!, $name: String!, $pr: Int!){
      repository(owner: $owner, name: $name) {
        id
        pullRequest(number: $pr) {
          id
        }
      }
    }
    `, {
        owner: context.repo.owner,
        name: context.repo.repo,
        pr: context.payload.pull_request && context.payload.pull_request.number,
    });
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
    };
    const { data } = await octokit.graphql(`
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
    `, input);
    return data;
};
const updateDeploymentStatus = async (deploymentId, state, environment, logUrl, environmentUrl) => {
    const input = {
        deploymentId,
        state,
        environment,
        logUrl,
        environmentUrl,
    };
    const { data: status } = await octokit.graphql(`
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
    `, {
        input,
    });
    return status;
};
/**
 * Start deploying
 */
const deploy = async () => {
    core.info(JSON.stringify(deploymentOptions, null, 2));
    let githubDeployment;
    for await (const event of now_client_1.createDeployment(appPath, deploymentOptions)) {
        const { payload, type } = event;
        try {
            if (type === 'created') {
                githubDeployment = await createGithubDeployment(payload);
                core.info(JSON.stringify(githubDeployment, null, 2));
            }
            else {
                let state = GithubDeploymentStatus.INACTIVE;
                switch (payload.readyState) {
                    case 'ANALYZING':
                        state = GithubDeploymentStatus.QUEUED;
                        break;
                    case 'BUILDING':
                        state = GithubDeploymentStatus.PENDING;
                        break;
                    case 'INITIALIZING':
                        state = GithubDeploymentStatus.QUEUED;
                        break;
                    case 'DEPLOYING':
                        state = GithubDeploymentStatus.IN_PROGRESS;
                        break;
                    case 'ERROR':
                        state = GithubDeploymentStatus.ERROR;
                        break;
                    case 'READY':
                        state = GithubDeploymentStatus.SUCCESS;
                        core.setOutput('previewUrl', payload.url);
                        break;
                    default:
                        break;
                }
                updateDeploymentStatus(githubDeployment.id, state, payload.target, payload.deploymentId, payload.url);
            }
        }
        catch (e) {
            updateDeploymentStatus(githubDeployment.id, GithubDeploymentStatus.FAILURE, payload.target, payload.deploymentId, payload.url);
        }
    }
};
deploy().catch(error => {
    core.setFailed(error.message);
});
