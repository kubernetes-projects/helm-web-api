const { Client, KubeConfig } = require('kubernetes-client');
const Request = require('kubernetes-client/backends/request');
const Config = require('./kube-config');

class KubeClient {
    constructor(clusterConfig) {
    // setup an API client
    const kubeconfig = new KubeConfig();
    kubeconfig.loadFromString(JSON.stringify(clusterConfig));
    const backend = new Request({ kubeconfig })
    const client = new Client({ backend, version: '1.13' })
    //const client = new Client({ config: config.loadKubeconfig(`${kubeConfigPath}/${releaseName}`) });
    this.client = client;
    }

    async resourceReadiness(namespace) {
        console.log(`checking resource rediness for namespace ${namespace}`);
        const serviceReady = await this.serviceReady(`${namespace}`);
        if (serviceReady.status != 'success') {
            return serviceReady;
        }
        const podsReady = await this.podReady(`${namespace}`);

        if (podsReady.status != 'success') {
            return podsReady;
        }

        const pvcReady = await this.volumeReady(`${namespace}`);

        if (pvcReady.status != 'success') {
            return pvcReady;
        }

        const deploymentReady = await this.deploymentsReady(`${namespace}`);

        if (deploymentReady.status != 'success') {
            return deploymentReady;
        }

        const statefulsetReady = await this.statefulsetReady(`${namespace}`);
        if(statefulsetReady.status != 'success') {
            return statefulsetReady;
        }
        return {status: 'success', message:'successfully provisioned'};
    }

    async getSecretsAndServices(namespace) {
        console.log(`getting Secrets and Services for namespace ${namespace}`);
        let servicesAndSecrets = {};
        const secrets =  await this.getSecrets(`${namespace}`);
        const services =  await this.getServices(`${namespace}`);
        servicesAndSecrets = {"secrets":secrets, "services": services};
       return servicesAndSecrets;
    }

    async serviceReady(namespace) {
        const services = await this.client.api.v1.namespace(`${namespace}`).services.get();
        console.log(services);
        let servicesReady = 'success';
        let message = '';
        services.body.items.forEach(service => {
            if (service.spec.type == "LoadBalancer") {
                if (!service.status.loadBalancer.ingress || service.status.loadBalancer.ingress.length  < 1) {
                    servicesReady = 'inprogress';
                }
            }
        });
        if (!servicesReady) {
            message = 'service deployment load balancer in progress';
        }
        return {status: servicesReady, message: message};
    }

    async podReady(namespace) {
        const pods = await this.client.api.v1.namespace(`${namespace}`).pods.get();
        console.log(pods);
        let podsReady = 'success';
        let message = '';
        pods.body.items.forEach(pod => {
            if (pod.status.phase != "Running") {
                podsReady = 'inprogress';
                pod.status.conditions.forEach(condition => {
                    if (condition.message != '') {
						message = message + condition.message + "\n"
					}
                }); 
			}
        });
        return {status: podsReady, message: message};
    }

    async volumeReady(namespace) {
        const pvcs = await this.client.api.v1.namespace(`${namespace}`).persistentvolumeclaims.get();
        console.log(`pvcs: ${pvcs.body}`);
        let pvcReady = 'success';
        let message = '';
        pvcs.body.items.forEach(pvc => {
            if (pvc.status.phase != 'Bound') {
                pvcReady = 'inprogress';
                message = `PersistentVolumeClaim is not ready: ${pvc.metadata.name}`;
			}
        });
        return {status: pvcReady, message: message};
    }

    async deploymentsReady(namespace) {
        const deployments = await this.client.apis.apps.v1beta1.namespaces(namespace).deployments.get();
        console.log(`deployments: ${deployments.body}`);
        let deploymentReady = 'success';
        let message = '';
        deployments.body.items.forEach(deployment => {
            if (deployment.status.readyReplicas < deployment.spec.replicas) {
                deploymentReady = 'inprogress';
                message = `Deployment is not ready: ${deployment.metadata.name}`;
			}
        });
        return {status: deploymentReady, message: message};
    }

    async statefulsetReady(namespace) {
        const statefulsets = await this.client.apis.apps.v1.namespaces(namespace).statefulsets.get();
        console.log(`statefulsets: ${statefulsets.body}`);
        let statefulsetReady = 'success';
        let message = '';
        statefulsets.body.items.forEach(statefulset => {
            if (!statefulset.status.readyReplicas || (statefulset.status.readyReplicas < statefulset.spec.replicas)) {
                statefulsetReady = 'inprogress';
                message = `Statefulset is not ready: ${statefulset.metadata.name}`;
			}
        });
        return {status: statefulsetReady, message: message};
    }

    async getSecrets(namespace) {
        const secrets = await this.client.api.v1.namespaces(namespace).secrets.get();
        console.log(`secrets: ${secrets.body}`);
        let secretMap = [];
        secrets.body.items.forEach(secret => {
            if (secret.type === 'Opaque') {   
                /* let credentialSecrets = {};             
                for (const key in secret.data) {                   
                    credentialSecrets = (...credentialSecrets, ...{key: secret.data[key]});
                } */
                let credentials = {};
                credentials= {"name": secret.metadata.name, "data": secret.data};
                secretMap.push(credentials);
			}
        });
        return secretMap;
    }

    async getServices(namespace) {
        const services = await this.client.api.v1.namespaces(namespace).services.get();
        console.log(`services: ${services.body}`);
        let serviceMap = [];
        services.body.items.forEach(service => {
            let credentials = {};
            credentials = {"name": service.metadata.name,
            "metadata": service.metadata,
            "spec": service.spec,
            "status": service.status};
            serviceMap.push(credentials);
        });
        return serviceMap;
    }

    async deleteNamespace(namespace) {
        await this.client.api.v1.namespaces(namespace).delete();
    }
}

module.exports = KubeClient;