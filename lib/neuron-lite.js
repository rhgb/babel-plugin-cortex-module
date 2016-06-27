var define;
!function () {
    var extDeps = $EXTDEPS$;
    var extDepIds = Object.keys(extDeps).map(function (key) {
        return extDeps[key].id;
    });
    var registry = {};

    function check() {
        for (var id in registry) {
            var curr = registry[id];
            if (!curr.ready && curr.deps.every(function (depId) {
                    return extDepIds.indexOf(depId) >= 0 || (registry[depId] && registry[depId].ready);
                })) exec(id);
        }
    }

    function exec(id) {
        var curr = registry[id];
        var deps = curr.deps.reduce(function (deps, depId) {
            if (extDepIds.indexOf(depId) < 0) {
                deps[depId] = registry[depId].mod;
            }
            return deps;
        }, {});
        var mod = {exports: {}};

        function req(name) {
            if (extDeps[name]) return extDeps[name].mod;
            var reqId = curr.conf.map[name];
            return deps[reqId];
        }
        req.async = function (name, cb) {
            setTimeout(cb(req(name)), 0);
        };
        req.resolve = function () {
            try {
                console.warn('cortex require.resolve is currently not supported by babel-plugin-cortex-module.');
                console.trace();
            } catch(e) {}
        };

        curr.factory(req, mod.exports, mod);
        curr.mod = mod.exports;
        curr.ready = true;
        if (curr.conf.main) module.exports = mod.exports;
        check();
    }

    define = function (id, deps, factory, config) {
        registry[id] = {
            id: id,
            factory: factory,
            deps: deps,
            conf: config,
            ready: false
        };
        if (!deps.length || deps.every(function (depId) {
                return extDepIds.indexOf(depId) >= 0;
            })) exec(id);
    };
}();