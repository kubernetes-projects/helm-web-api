## Port service 
FROM node:alpine

## Install Helm

# Note: Latest version of kubectl may be found at: # https://aur.archlinux.org/packages/kubectl-bin/ 
ARG KUBE_LATEST_VERSION="v1.10.2" 
# Note: Latest version of helm may be found at: # https://github.com/kubernetes/helm/releases 
ARG HELM_VERSION="v3.0.3" 

ENV HELM_HOME="/usr/local/bin/"
ENV HELM_BINARY="/usr/local/bin/helm"
RUN mkdir /usr/local/bin/plugins
RUN apk add --no-cache ca-certificates bash \
    && wget -q https://storage.googleapis.com/kubernetes-release/release/${KUBE_LATEST_VERSION}/bin/linux/amd64/kubectl -O /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && apk add curl -y \
    && curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 \
    && chmod 700 get_helm.sh \
    && ./get_helm.sh
RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh
RUN helm plugin install https://github.com/dunefro/helm-json-output --version master

# Create app directory
WORKDIR /usr/src

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

EXPOSE 4000
CMD [ "npm", "start" ]
