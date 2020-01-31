const path = require('path');
const shell = require('shelljs');
const fs = require('fs-extra');
const configs = require('../../configs/app-configs');
const dockerfileTemplate = require('../../templates/dockerfile.template');
const nginxConfTemplate = require('../../templates/nginx.conf.template');
const startScript = require('../../templates/start.template');
const exec = require('../util/exec');

let imageVersion = configs.version;
let imageName = configs.name;
let dockerRegistry = configs.dockerRegistry;
let debug = configs.debug;
const commandLineArguments = process.argv.slice(3);

commandLineArguments.forEach(arg => {
    let [argName, argValue] = arg.split('=');
    argName = argName.toLowerCase().trim();
    argValue = argValue ? argValue.trim() : '';
    switch (argName) {
        case 'version':
            imageVersion = argValue;
            break;
        case 'name':
            imageName = argValue;
            break;
        case 'debug':
            debug = argValue;
            break;
        default:
            console.warn(`Unknown argument ${argName}`);
    }
});

const tempDirName = '.docker-build';
const pathToTempDir = path.join(configs.cwd, tempDirName);
const imageFullName = `${dockerRegistry ? `${dockerRegistry}/` : ''}${imageName}:${imageVersion}`;

(async () => {
    try {
        console.log(`Build docker image ${imageFullName}`);
        console.time('Total time');
        console.time('Setting up time');
        // create tmp directory for docker related files
        // We need to copy it because we will remove this directory during build process

        await fs.emptyDir(pathToTempDir);

        const nginxConf = configs.localNginxConf
            ? await fs.readFile(configs.localNginxConf, 'utf8')
            : nginxConfTemplate;

        const dockerfile = configs.localDockerfile
            ? await fs.readFile(configs.localDockerfile, 'utf8')
            : dockerfileTemplate;

        await Promise.all([
            fs.writeFile(path.join(pathToTempDir, 'Dockerfile'), dockerfile, 'utf8'),
            fs.writeFile(path.join(pathToTempDir, 'nginx.conf'), nginxConf, 'utf8'),
            fs.writeFile(path.join(pathToTempDir, 'start.sh'), startScript, { encoding: 'utf8', mode: 0o555 }),
            fs.remove(configs.buildPath),
        ]);

        console.timeEnd('Setting up time');
        console.time('Build application time');
        // run build script
        await exec('npm run build');

        console.timeEnd('Build application time');
        console.time('Remove dev dependencies time');
        // if yarn is available prune dev dependencies with yarn, otherwise use npm
        if (configs.useYarn && shell.which('yarn')) {
            await exec('yarn install --production --ignore-optional --frozen-lockfile --ignore-scripts --prefer-offline');
        } else {
            await exec('npm prune --production');
        }

        console.timeEnd('Remove dev dependencies time');
        console.time('Build docker image time');
        await exec(`docker build -f "./${tempDirName}/Dockerfile" \\
 --build-arg START_SH_LOCATION="./${tempDirName}/start.sh" \\
 --build-arg NGINX_CONF_LOCATION="./${tempDirName}/nginx.conf" -t ${imageFullName} .`);

        console.timeEnd('Build docker image time');
        console.time('Cleanup time');

        // remove temp directory
        await fs.remove(pathToTempDir);

        // guard against pushing the image during tests
        if (!debug) {
            await exec(`docker push ${imageFullName}`);
        }

        console.timeEnd('Cleanup time');
        console.timeEnd('Total time');
    } catch (err) {
        await fs.remove(pathToTempDir);
        console.error('Error during docker-build.');
        if (configs.debug) {
            console.error(err);
        }
        process.exit(1);
    }
})();
