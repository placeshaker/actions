LABEL "com.github.actions.name" = "Deploy Articho"
LABEL "com.github.actions.description" = "Deploy public website articho"
LABEL "com.github.actions.icon" = "send"
LABEL "com.github.actions.color" = "blue"

LABEL "repository" = "https://github.com/placeshaker/actions"
LABEL "homepage" = "https://github.com/placeshaker/actions"

FROM node:slim
COPY . .
RUN npm install --production
ENTRYPOINT ["node", "/dist/index.js"]
