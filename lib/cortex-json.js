'use strict';
var fse = require('fs-extra');
var path = require('path');
module.exports = {
    readCortexJSONSync: function (dirPath) {
        var cortexPath = path.join(dirPath, 'cortex.json');
        var packagePath = path.join(dirPath, 'package.json');
        var json = fse.readJsonSync(cortexPath, {throws: false});
        if (json && json.name && json.main) return {
            name: json.name,
            main: json.main,
            dependencies: json.dependencies || {}
        };
        // cortex.json doesn't exists or corrupted. use package.json instead
        json = fse.readJsonSync(packagePath, {throws: false});
        if (json && json.name && json.main) return {
            name: json.name,
            main: json.main,
            dependencies: {}
        };
        console.warn(dirPath, 'cortex.json or package.json should have `name` and `main` properties.');
        return null;
    }
};