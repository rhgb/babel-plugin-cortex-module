'use strict';
var nodePath = require('path');
var fs = require('fs');
var fse = require('fs-extra');
var semver = require('semver');
var slash = require('slash');
var cortexJSON = require('./lib/cortex-json');

var project = null;
var cortexModules = {};

module.exports = function (babel) {
    var t = babel.types;
    return {
        visitor: {
            Program: function () {
                if (!project) {
                    project = {
                        root: this.file.opts.sourceRoot,
                        cortex: cortexJSON.readCortexJSONSync(this.file.opts.sourceRoot)
                    };
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
                    var filePath = this.file.opts.filenameRelative;
                    var pathRelativeToRoot;
                    if (nodePath.isAbsolute(filePath)) {
                        pathRelativeToRoot = nodePath.relative(project.root, filePath);
                    } else {
                        pathRelativeToRoot = filePath;
                    }

                    var actualFilePath = null;
                    if (requireParam.indexOf('@cortex/') === 0) {  // is requiring a cortex module
                        var requiredName = requireParam.slice('@cortex/'.length);
                        actualFilePath = getActualPath(requiredName);

                    } else if (/^neurons[/\\]/.test(pathRelativeToRoot) && requireParam[0] !== '.') {
                        // file itself is a cortex module
                        actualFilePath = getActualPath(requireParam);
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

function getActualPath(requiredName) {
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
    var versionRule = project.cortex.dependencies[depName];
    if (!versionRule) throw new Error('cortex package ' + depName + ' required but not defined in cortex.json');
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