const util = require('util');
const exec = util.promisify(require('child_process').exec);
const yaml = require('js-yaml');
const fs = require('fs');
const Kube = require('./kube-client');
const KubeConfig = require('./kube-config');

const helmBinaryLocation = process.env.HELM_BINARY;

class Helm {
  async install(deployOptions) {
    console.log(`Installing new chart. deployOptions: ${JSON.stringify(deployOptions)}`);
    const chartName = deployOptions.chartName;
    const releaseName  = deployOptions.releaseName;
    let installCommand = `install`;

    // sanity
    Helm._validateNotEmpty(chartName, 'chartName');
    Helm._validateNotEmpty(releaseName, 'releaseName');

    if (releaseName !== undefined && releaseName != null && releaseName !== '') {
      console.log(`Installing specified release name: ${releaseName}`);
      installCommand = `${installCommand} ${releaseName} ${chartName} --namespace ${releaseName} --create-namespace --output json`;
    }
    //append config details
    installCommand = await this.appendConfig(releaseName, installCommand);

    console.log(`Install command: ${installCommand}`);
    return this._installOrUpgradeChart(installCommand, deployOptions)
      .then((relStatus) => {
        const j_response =  JSON.parse(relStatus.json);
        console.log(j_response.info.status.code);
        /* UNKNOWN":          0,
           "DEPLOYED":         1,
           "DELETED":          2,
           "SUPERSEDED":       3,
           "FAILED":           4,
           "DELETING":         5,
           "PENDING_INSTALL":  6,
           "PENDING_UPGRADE":  7,
           "PENDING_ROLLBACK": 8, */
           switch (j_response.info.status.toUpperCase()) {
             case 'PENDING_INSTALL':
             case 'DEPLOYED':
              return {status: j_response.info.status, message: j_response.info.description};
              break;   
             default:
              console.error(j_response.info.description);
              throw new Error(j_response.info.description);
         }        
      });
  }

  async delete(delOptions) {
    const { releaseName } = delOptions;
    Helm._validateNotEmpty(releaseName, 'releaseName');
    console.log(`deleting release: ${releaseName}`);
    let uninstallCommand = `uninstall ${releaseName} --namespace ${releaseName}`;
    uninstallCommand = await this.appendConfig(releaseName, uninstallCommand);
    const config = new KubeConfig();
    const clusterConfig = await config.getKubeConfig(releaseName);
    return this._executeHelm(uninstallCommand).then(() =>{      
      const kubeClient  = new Kube(clusterConfig.data);
      kubeClient.deleteNamespace(releaseName);
    }, error => {
      console.error(error);
      throw new Error(error);
    });
    
  }

  async upgrade(deployOptions) {
    const chartName = deployOptions.chartName;
    const releaseName = deployOptions.releaseName;

    Helm._validateNotEmpty(chartName, 'chartName');
    Helm._validateNotEmpty(releaseName, 'releaseName');

    let upgradeCommand = `upgrade ${releaseName} ${chartName} --namespace ${releaseName} --output json`;
    upgradeCommand = await this.appendConfig(releaseName, upgradeCommand);
    console.log(`upgrade command: ${upgradeCommand}`);
    return this._installOrUpgradeChart(upgradeCommand, deployOptions).then((relStatus) => {
      const j_response =  JSON.parse(relStatus.json);
      console.log(j_response.info.status);
      /* UNKNOWN":          0,
         "DEPLOYED":         1,
         "DELETED":          2,
         "SUPERSEDED":       3,
         "FAILED":           4,
         "DELETING":         5,
         "PENDING_INSTALL":  6,
         "PENDING_UPGRADE":  7,
         "PENDING_ROLLBACK": 8, */
         switch (j_response.info.status.toUpperCase()) {
           case 'PENDING_UPGRADE':
           case 'DEPLOYED':
            return {status: j_response.info.status, message: j_response.info.description};
            break;   
           default:
            console.error(j_response.info.description);
            throw new Error(j_response.info.description);
       }        
    });
  }

  async releaseStatus(options) {
    const { releaseName } = options;
    Helm._validateNotEmpty(releaseName, 'releaseName');
    let statusCommand = `status ${releaseName} --namespace ${releaseName} --output json`;
    statusCommand = await this.appendConfig(releaseName, statusCommand);
    console.log(`status command: ${statusCommand}`);
    const relStatus = await this._executeHelm(statusCommand);  
    const j_response =  JSON.parse(relStatus.json);
    let releaseStatus = {status: '', message:''};
    console.log(j_response.info.status);
   /* UNKNOWN":          0,
      "DEPLOYED":         1,
      "DELETED":          2,
      "SUPERSEDED":       3,
      "FAILED":           4,
      "DELETING":         5,
      "PENDING_INSTALL":  6,
      "PENDING_UPGRADE":  7,
      "PENDING_ROLLBACK": 8, */
      switch (j_response.info.status.toUpperCase()) {
        case 'DEPLOYED':
          const config = new KubeConfig();
          const clusterConfig = await config.getKubeConfig(releaseName);
          const kubeClient  = new Kube(clusterConfig.data);
          releaseStatus = await kubeClient.resourceReadiness(`${releaseName}`);
          break;
        case 'PENDING_INSTALL':
        case 'PENDING_UPGRADE':
          releaseStatus = {status: 'inprogress', message: 'deploy in progress'};
          break;      
        default:
          releaseStatus = {status: 'failed', message: 'deploy failed with code:'+j_response.info.status.code};
          break;
    }    
    return releaseStatus;
  }

  async releaseConnectionDetails(options) {
    const { releaseName } = options;
    Helm._validateNotEmpty(releaseName, 'releaseName');
    const config = new KubeConfig();
    const clusterConfig = await config.getKubeConfig(releaseName);

    const kubeClient  = new Kube(clusterConfig.data);
    return await kubeClient.getSecretsAndServices(`${releaseName}`);
  }

  static _validateNotEmpty(arg, argName) {
    if (typeof arg === 'undefined' || arg === null || arg === '') {
      const errorMsg = `${argName} is required`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  static _findFirstService(json) {
    const service = json.resources.find(el => el.name.toLowerCase().includes('/service'));
    return (service && service.resources[0]) || null;
  }

  static _convertToBool(obj) {
    if (obj == null) {
      return false;
    }

    // will match one and only one of the string 'true','1', or 'on' regardless
    // of capitalization and regardless of surrounding white-space.
    //
    const regex = /^\s*(true|1|on)\s*$/i;

    return regex.test(obj.toString());
  }

  async _executeHelm(command, flags= '', values = '') {
    console.log(`command: ${command}`);
    console.log(`flags: ${flags}`);
    console.log(`values: ${values}`);
    const { stdout, stderr } = await exec(`${helmBinaryLocation} ${command}${flags}${values}`,{maxBuffer: 2000 * 2000});
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
    return { error: stderr, json: stdout };
  }

  static _getConfigValues(deployObject) {
    if (this.deployObject) {
      return '';
    }

    let configStr = '';
    for (const attribute in deployObject) {
      if (deployObject.hasOwnProperty(attribute)) {
        configStr += ` --set ${attribute}=${deployObject[attribute]}`;
      }
    }
    return configStr;
  }

  static _getArguments(deployArgs) {
    if(this.deployArgs) {
      return '';
    }
    let configStr = '';
    for (const attribute in deployArgs) {
      if (deployArgs.hasOwnProperty(attribute)) {
        configStr += ` --${attribute} ${deployArgs[attribute]}`;
      }
    }
    return configStr;
  }

  async _installOrUpgradeChart(command, deployOptions) {
    let updatedCmd = command;
    const chartName = deployOptions.chartName;

    // when requesting install from a private repository,
    // helm repositories list must be updated first
    if (deployOptions.privateChartsRepo) {
      const tokens = chartName.split('/');
      // adds the private repo to helm known repos
      await this._executeHelm(`repo add ${tokens[0]} ${deployOptions.privateChartsRepo}`);
    }

    // fetch the data from all known repos
    await this._executeHelm('repo update');

    if (deployOptions.reuseValue !== undefined
      && Helm._convertToBool(deployOptions.reuseValue)) {
      updatedCmd += ' --reuse-values ';
    }

    // install the chart from one of the known repos
    return this._executeHelm(updatedCmd, Helm._getArguments(deployOptions.flags), Helm._getConfigValues(deployOptions.values));
  }

  async appendConfig(releaseName, command) {
    const kubeConfig = new KubeConfig();
    const config = await kubeConfig.getKubeConfig(releaseName);
    command = `${command} --kube-apiserver ${config.data.clusters[0].cluster.server} --kube-token ${config.data.users[0].user.token}`;
    return command;
  }
}

module.exports = Helm;
