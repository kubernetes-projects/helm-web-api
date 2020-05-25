const util = require('util');
const exec = util.promisify(require('child_process').exec);
const yaml = require('js-yaml');
const fs = require('fs');
const Kube = require('./kube-client');
const KubeConfig = require('./kube-config');

const helmBinaryLocation = process.env.HELM_BINARY;
// const kubeConfigPath = process.env.CONFIG_PATH;

/** Since the installation is via a Chart, init was already been called, no need to init again.
 * We are leaving this as a comment, in case someone will need to execute it when
 * installed via yaml files
 */
// console.log('Initializing tiller with service account: ' + process.env.TILLER_SERVICE_ACCOUNT);
// exec(helmBinaryLocation + ' init --service-account ' + process.env.TILLER_SERVICE_ACCOUNT);

// Run once init client only (because tiller is already installed, see above)
console.log(`Initializing helm client. helm binary: ${helmBinaryLocation}`);
exec(`${helmBinaryLocation} init --client-only`);

class Helm {
  async install(deployOptions) {
    console.log(`Installing new chart. deployOptions: ${JSON.stringify(deployOptions)}`);
    const chartName = deployOptions.chartName.toLowerCase();
    const releaseName  = deployOptions.releaseName.toLowerCase();
    let installCommand = `json install ${chartName}`;

    // sanity
    Helm._validateNotEmpty(chartName, 'chartName');
    Helm._validateNotEmpty(releaseName, 'releaseName');

    console.log(`cluster config: ${deployOptions.clusterName}`);
    //Helm._generateClusterConfig(deployOptions.clusterConfig, releaseName);
    const kubeConfig = new KubeConfig();
    const configPath = await kubeConfig.generateKubeConfig(releaseName);

    if (releaseName !== undefined && releaseName != null && releaseName !== '') {
      console.log(`Installing specified release name: ${releaseName}`);
      installCommand = `${installCommand} --name ${releaseName.toLowerCase()} --kubeconfig ${configPath}`;
    }

    console.log(`Install command: ${installCommand}`);
    return this._installOrUpgradeChart(installCommand, deployOptions)
      .then((responseData) => {
        if (responseData && responseData.error) {
          const errLog = `Install command failed: ${responseData.error}`;
          console.error(errLog);
          throw new Error(errLog);
        } else if (!responseData) {
          const errLog = 'Install command failed: empty response';
          console.error(errLog);
          throw new Error(errLog);
        } else {
          console.log('succesfully finished helm command');
          const json = JSON.parse(responseData.json);
          const svc = Helm._findFirstService(json);
          if (svc) {
            return {
              serviceName: svc,
              releaseName: json.releaseName,
            };
          }

          const errLog = `Install command returned unknown response: ${responseData.json}`;
          console.error(errLog);
          throw new Error(errLog);
        }
      });
  }

  async delete(delOptions) {
    const { releaseName } = delOptions;
    Helm._validateNotEmpty(releaseName, 'releaseName');
    const configPath = await getConfigPath(releaseName);
    console.log(`deleting release: ${releaseName}`);
    return this._executeHelm(`delete ${releaseName} --kubeconfig ${configPath}`);
  }

  async upgrade(deployOptions) {
    const chartName = deployOptions.chartName.toLowerCase();
    const releaseName = deployOptions.releaseName.toLowerCase();

    Helm._validateNotEmpty(chartName, 'chartName');
    Helm._validateNotEmpty(releaseName, 'releaseName');
    const configPath = await getConfigPath(releaseName);

    const upgradeCommand = `upgrade ${releaseName} ${chartName} --kubeconfig ${configPath}`;
    console.log(`upgrade command: ${upgradeCommand}`);
    return this._installOrUpgradeChart(upgradeCommand, deployOptions);
  }

  async releaseStatus(options) {
    const { releaseName } = options;
    Helm._validateNotEmpty(releaseName, 'releaseName');
    const configPath = await getConfigPath(releaseName);
    const statusCommand = `status ${releaseName} --kubeconfig ${configPath} --output json`;
    console.log(`status command: ${statusCommand}`);
    const relStatus = await this._executeHelm(statusCommand);  
    const j_response =  JSON.parse(relStatus.json);
    let releaseStatus = {status: '', message:''};
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
      switch (j_response.info.status.code) {
        case 1:
          const kubeClient  = new Kube(`${configPath}`);
          releaseStatus = await kubeClient.resourceReadiness(`${releaseName}`);
          break;
        case 6:
        case 7:
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
    const configPath = await getConfigPath(releaseName);
    const kubeClient  = new Kube(`${configPath}`);
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
    const { stdout, stderr } = await exec(`${helmBinaryLocation} ${command}${flags}${values}`);
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
    const chartName = deployOptions.chartName.toLowerCase();

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

  async getConfigPath(releaseName) {
    const kubeConfig = new KubeConfig();
    const configPath = await kubeConfig.generateKubeConfig(releaseName);
    return configPath;
  }
}

module.exports = Helm;
