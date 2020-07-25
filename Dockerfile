## Port service 
FROM node:alpine

## Install Helm

# Note: Latest version of kubectl may be found at: # https://aur.archlinux.org/packages/kubectl-bin/ 
ARG KUBE_LATEST_VERSION="v1.16.2" 
# Note: Latest version of helm may be found at: # https://github.com/kubernetes/helm/releases 
ARG HELM_VERSION="v3.2.0" 

ENV HELM_HOME="/usr/local/bin/"
ENV HELM_BINARY="/usr/local/bin/helm"
RUN mkdir /usr/local/bin/plugins
RUN apk add --no-cache ca-certificates bash \
    && wget -q https://storage.googleapis.com/kubernetes-release/release/${KUBE_LATEST_VERSION}/bin/linux/amd64/kubectl -O /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && wget -q https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz -O - | tar -xzO linux-amd64/helm > /usr/local/bin/helm \
    && chmod +x /usr/local/bin/helm
RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh
RUN helm plugin install https://github.com/Mangiang/helm-json-output --version master

# Add basic repos and update
RUN helm repo add stable https://kubernetes-charts.storage.googleapis.com/
RUN helm repo add mangiang https://mangiang.github.io/helm-chart/
RUN helm repo update

# Create app directory
WORKDIR /usr/src

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN yarn install

# Bundle app source
COPY . .
EXPOSE 4002
ENV PORT 4002
CMD [ "yarn", "start" ]
