const request = require("request");
const yaml = require("js-yaml");
const fs = require("fs");

//environment variables
const kubeConfigPath = process.env.CONFIG_PATH;
const hcaasApiUrl = process.env.HCAAS_API_URL;

class KubeConfig {
  async generateKubeConfig(releaseName) {
    const clusterName = await getClusetrName(releaseName);
    console.log(`getting config file for cluster ${clusterName}`);
    const configExist = isConfigExist(clusterName);
    if (!configExist) {
      request.get(
        `${hcaasApiUrl}/cluster/config?clusterName=${clusterName}`,
        { json: true },
        (err, res, body) => {
          if (err) {
            throw new Error(err);
          }
          console.log(body);
          _saveClusterConfig(body, clusterName);
        }
      );
    }
  }

  async getClusetrName(releaseName) {
    console.log(`getting config for release ${releaseName}`);
    let clusterName = '';
    request.get(
        `${hcaasApiUrl}/cluster_release_map?releaseName=${releaseName}`,
        { json: true },
        (err, res, body) => {
          if (err) {
            throw new Error(err);
          }
          console.log(`received clustername is ${body.clusterName}`);
          clusterName = body.clusterName;
        }
      );
      return clusterName;
  }

  static isConfigExist(clusterName) {
    fs.access(`${kubeConfigPath}/${clusterName}`, (err) => {
      if (err) {
        console.log(`config doesnot exist for cluster ${clusterName}`);
        return false;
      } else {
        console.log(`config exist for cluster ${clusterName}`);
        return true;
      }
    });
  }

  static _saveClusterConfig(config, clusterName) {
    let yamlconfig = yaml.safeDump(config);
    fs.writeFileSync(`${kubeConfigPath}/${clusterName}`, yamlconfig, "utf8");
  }
}
module.exports = KubeConfig;