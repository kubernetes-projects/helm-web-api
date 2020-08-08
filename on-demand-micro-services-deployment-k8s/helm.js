﻿const util = require('util')
const exec = util.promisify(require('child_process').exec)

const helmBinaryLocation = process.env.HELM_BINARY
const kubectlBinaryLocation = process.env.KUBECTL_BINARY
    /** Since the installation is via a Chart, init was already been called, no need to init again.
     * We are leaving this as a comment, in case someone will need to execute it when
     * installed via yaml files
     */
    // console.log('Initializing tiller with service account: ' + process.env.TILLER_SERVICE_ACCOUNT);
    // exec(helmBinaryLocation + ' init --service-account ' + process.env.TILLER_SERVICE_ACCOUNT);

// Run once init client only (because tiller is already installed, see above)
console.log(`Initializing helm client. helm binary: ${helmBinaryLocation}`)
    // exec(`${helmBinaryLocation} init --client-only`);

class Helm {
    async install(deployOptions) {
        console.log(
            `Installing new chart. deployOptions: ${JSON.stringify(deployOptions)}`,
        )
        const chartName = deployOptions.chartName.toLowerCase()
        const { releaseName } = deployOptions
        let installCommand = `json install`

        // sanity
        Helm._validateNotEmpty(chartName, 'chartName')

        if (
            releaseName !== undefined &&
            releaseName != null &&
            releaseName !== ''
        ) {
            console.log(`Installing specified release name: ${releaseName}`)
            installCommand = `${installCommand} ${releaseName.toLowerCase()} ${chartName}`
        }

        console.log(`Install command: ${installCommand}`)
        return this._installOrUpgradeChart(installCommand, deployOptions).then(
            (responseData) => {
                console.log(responseData)
                if (responseData && responseData.error) {
                    const errLog = `Install command failed: ${responseData.error}`
                    console.error(errLog)
                    throw new Error(errLog)
                } else if (!responseData) {
                    const errLog = 'Install command failed: empty response'
                    console.error(errLog)
                    throw new Error(errLog)
                } else {
                    console.log('succesfully finished helm command')
                    const json = JSON.parse(responseData.json)
                    if (json) {
                        return {
                            serviceName: json.releaseName,
                        }
                    }

                    const errLog = `Install command returned unknown response: ${responseData.json}`
                    console.error(errLog)
                    throw new Error(errLog)
                }
            },
        )
    }

    async uninstall(delOptions) {
        const { releaseName } = delOptions
        Helm._validateNotEmpty(releaseName, 'releaseName')

        console.log(`deleting release: ${releaseName}`)
        return this._executeHelm(`uninstall ${releaseName}`)
    }

    async getDeployed() {
        console.log(`getting releases`)
        return this._executeHelm(`list -o json`)
    }

    async getServices() {
        console.log(`getting services`)
        const servicesStr = await this._executeKubectl(`get services -o json`)
        console.log(`servicesStr ${JSON.stringify(servicesStr)}`)
        const servicesJson = JSON.parse(servicesStr.json)
        console.log(`servicesJson ${JSON.stringify(servicesJson)}`)
        const services = []
        servicesJson.items.forEach(elt => {
            services.push({ name: elt.metadata.name })
        });
        console.log(`services ${JSON.stringify(services)}`)
        return services
    }

    async upgrade(deployOptions) {
        const chartName = deployOptions.chartName.toLowerCase()
        const releaseName = deployOptions.releaseName.toLowerCase()

        Helm._validateNotEmpty(chartName, 'chartName')
        Helm._validateNotEmpty(releaseName, 'releaseName')

        const upgradeCommand = `upgrade ${releaseName} ${chartName}`
        console.log(`upgrade command: ${upgradeCommand}`)
        return this._installOrUpgradeChart(upgradeCommand, deployOptions)
    }

    static _validateNotEmpty(arg, argName) {
        if (typeof arg === 'undefined' || arg === null || arg === '') {
            const errorMsg = `${argName} is required`
            console.error(errorMsg)
            throw new Error(errorMsg)
        }
    }

    static _convertToBool(obj) {
        if (obj == null) {
            return false
        }

        // will match one and only one of the string 'true','1', or 'on' regardless
        // of capitalization and regardless of surrounding white-space.
        //
        const regex = /^\s*(true|1|on)\s*$/i

        return regex.test(obj.toString())
    }

    async _executeHelm(command, values = '') {
        console.log(`command: ${command}`)
        console.log(`values: ${values}`)
        const { stdout, stderr } = await exec(
            `${helmBinaryLocation} ${command}${values}`,
        )
        console.log('stdout:', stdout)
        console.log('stderr:', stderr)
        return { error: stderr, json: stdout }
    }

    async _executeKubectl(command, values = '') {
        console.log(`command: ${command}`)
        console.log(`values: ${values}`)
        const { stdout, stderr } = await exec(
            `${kubectlBinaryLocation} ${command}${values}`,
        )
        console.log('stdout:', stdout)
        console.log('stderr:', stderr)
        return { error: stderr, json: stdout }
    }

    static _getConfigValues(deployObject) {
        if (this.deployObject) {
            return ''
        }

        let configStr = ''
        for (const attribute in deployObject) {
            if (deployObject.hasOwnProperty(attribute)) {
                configStr += ` --set ${attribute}=${deployObject[attribute]}`
            }
        }
        return configStr
    }

    async _installOrUpgradeChart(command, deployOptions) {
        let updatedCmd = command
        const chartName = deployOptions.chartName.toLowerCase()

        // when requesting install from a private repository,
        // helm repositories list must be updated first
        if (deployOptions.privateChartsRepo) {
            const tokens = chartName.split('/')
                // adds the private repo to helm known repos
            await this._executeHelm(
                    `repo add ${tokens[0]} ${deployOptions.privateChartsRepo}`,
                )
                // fetch the data from all known repos
            await this._executeHelm('repo update')
        }

        if (
            deployOptions.reuseValue !== undefined &&
            Helm._convertToBool(deployOptions.reuseValue)
        ) {
            updatedCmd += ' --reuse-values '
        }

        // install the chart from one of the known repos
        return this._executeHelm(
            updatedCmd,
            Helm._getConfigValues(deployOptions.values),
        )
    }
}

module.exports = Helm