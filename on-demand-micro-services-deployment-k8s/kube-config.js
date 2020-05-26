const axios = require("axios");
const yaml = require("js-yaml");
const fs = require("fs");

//environment variables
//const kubeConfigPath = process.env.CONFIG_PATH;
const hcaasApiUrl = process.env.HCAAS_API_URL;

class KubeConfig {
 async getKubeConfig(releaseName) {
    try {
        const config =  await axios.get(`${hcaasApiUrl}/clusterConfig?releaseName=${releaseName}`);
        return config;
    } catch (error) {
        console.error(error)
        throw new Error(error);
    }       
  }

  

}
module.exports = KubeConfig;