'use strict';
var nodePath = require('path');
var fs = require('fs');
var semver = require('semver');
var slash = require('slash');
var cortexJSON = require('./lib/cortex-json');

var neuronLiteJS = fs.readFileSync(nodePath.join(__dirname, 'lib/neuron-lite.js'), {encoding: 'utf-8'});
var project = null;
var cortexModules = {};

module.exports = function (babel) {
    var t = babel.types;
    return {
        visitor: {
            Program: function (path) {
                if (!project) {
                    project = {
                        root: this.file.opts.sourceRoot,
                        cortex: cortexJSON.readCortexJSONSync(this.file.opts.sourceRoot)
                    };
                }

                // calculate current file path
                var filePath = this.file.opts.filenameRelative;
                var pathRelativeToRoot;
                if (nodePath.isAbsolute(filePath)) {
                    pathRelativeToRoot = nodePath.relative(project.root, filePath);
                } else {
                    pathRelativeToRoot = filePath;
                }

                // alter cortex built file
                if (/^neurons[/\\]/.test(pathRelativeToRoot)) {
                    var pathNames = pathRelativeToRoot.split(/[/\\]/);
                    var modName = pathNames[1];
                    var modVer = pathNames[2];
                    if (pathNames[3] === modName + '.js') {  // is cortex module main file
                        // parse inner module map
                        var nodes = path.node.body[0].expression.callee.body.body;
                        var deps = [];
                        for (var i = 1; i < nodes.length; i++) {
                            var node = nodes[i];
                            if (t.isVariableDeclaration(node)) {
                                var declarator = node.declarations[0];
                                if (/^_\d+$/.test(declarator.id.name)) {
                                    deps.push(declarator.init.value);
                                }
                            } else break;
                        }
                        var internalDepPrefix = modName + '@' + modVer + '/';
                        var depStr = deps.filter(function (depName) {
                            return depName.indexOf(internalDepPrefix) !== 0;
                        }).reduce(function (depStr, depName) {
                            var atPos = depName.indexOf('@');
                            var slashPos = depName.indexOf('/');
                            if (atPos <= 0) throw new Error('Illegal format: ' + depName);
                            var requiredName = depName.slice(0, atPos);
                            var versionRule = depName.slice(atPos + 1);
                            if (slashPos > 0) {
                                requiredName += depName.slice(slashPos);
                            }
                            var actualPath = getActualPath(requiredName, versionRule);
                            depStr.push(JSON.stringify(requiredName) + ':{id:' + JSON.stringify(depName) + ',mod:require(' + JSON.stringify(actualPath) + ')}');
                            return depStr;
                        }, []);
                        var replaceStr = '{' + depStr.join(',') + '}';
                        var startupJS = neuronLiteJS.replace('$EXTDEPS$', replaceStr);
                        var startupJSNodes = babel.transform(startupJS).ast.program.body;
                        startupJSNodes.forEach(function (node) {
                            babel.traverse.removeProperties(node);
                        });
                        path.traverse({
                            FunctionDeclaration: function (path) {
                                if (startupJSNodes && t.isIdentifier(path.node.id, {name: 'mix'})) {
                                    path.insertBefore(startupJSNodes);
                                    startupJSNodes = null;
                                }
                            }
                        })
                    }
                }
            },
            CallExpression: function(path) {
                if (
                    t.isIdentifier(path.node.callee, {name: 'require'}) &&
                    !path.scope.hasBinding('require') &&
                    t.isStringLiteral(path.node.arguments[0])
                ) {
                    // is a require('moduleName') statement
                    var requireParam = path.node.arguments[0].value;

                    var actualFilePath = null;
                    if (requireParam.indexOf('@cortex/') === 0) {  // is requiring a cortex module
                        var requiredName = requireParam.slice('@cortex/'.length);
                        actualFilePath = getActualPath(requiredName);
                    }
                    if (actualFilePath) {
                        path.traverse({
                            StringLiteral: function (path) {
                                if (path.node.value === this.requireParam) {
                                    path.replaceWith(t.stringLiteral(actualFilePath));
                                }
                            }
                        }, {requireParam: requireParam, actualPath: actualFilePath});
                    }
                }
            }
        }
    }
};

function getActualPath(requiredName, versionRule) {
    var depName = requiredName;
    var isReqSpecFile = requiredName.indexOf('/') >= 0;  // require('@cortex/dpapp/some/source')
    if (isReqSpecFile) {
        depName = requiredName.slice(0, requiredName.indexOf('/'));
    }
    var depDir = nodePath.join(project.root, 'neurons', depName);

    // get dependency info according to depName
    var depInfo = cortexModules[depName];
    if (!depInfo) {  // dep info doesn't exist, generate it
        depInfo = [];
        var dirnames = null;
        try {
            dirnames = fs.readdirSync(depDir);
        } catch (e) {}
        if (dirnames) {
            depInfo = dirnames.sort(function (a, b) {  // sort to descending order
                if (a === b) return 0;
                return semver.lt(a, b) ? 1 : -1;
            }).map(function (version) {
                var res = cortexJSON.readCortexJSONSync(nodePath.join(depDir, version));
                if (res) res.version = version;
                return res;
            }).filter(function (item) {
                return item;
            });
        }
        cortexModules[depName] = depInfo;
    }

    // get matched dependency version
    if (!versionRule) {
        versionRule = project.cortex.dependencies[depName];
        if (!versionRule) throw new Error('cortex package ' + depName + ' required but not defined in cortex.json');
    }
    var matchedVersion = null;
    depInfo.some(function (item) {
        if (semver.satisfies(item.version, versionRule)) {
            matchedVersion = item;
            return true;
        }
    });
    if (!matchedVersion) throw new Error('cannot find matched version for ' + depName + '@' + versionRule);

    var actualFilePath;

    if (isReqSpecFile) {  // directly requiring specific file
        actualFilePath = nodePath.join(depName, matchedVersion.version, requiredName.slice(depName.length + 1));
    } else {
        actualFilePath = nodePath.join(depName, matchedVersion.version, depName + '.js');
    }

    return slash(actualFilePath);
}