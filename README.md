# babel-plugin-cortex-module
babel plugin for import cortex module

## Usage

### Install

Install the plugin

```bash
npm i babel-plugin-cortex-module
```

### Configuration

Define plugin in `webpack.config.js` and add `neurons/` as resolve path:

```javascript
module.exports = {
    module: {
        loaders: [{
            test: /\.jsx?$/,
            loader: 'babel',
            exclude: /node_modules/,  // Don't exclude 'neurons' here
            query: {
                presets: ['react', 'es2015'],
                plugins: ["cortex-module"]  // Define plugin here
            }
        }
    },
    resolve: {
        modulesDirectories: ["node_modules", "neurons"]  // Add 'neurons' here
    }
}
```

### Module Usage

Add `@cortex` prefix to module name in your file:

```javascript
var $ = require('@cortex/zepto');

// es2015 syntax also supported
import $ from '@cortex/zepto';

// requiring specific files
var something = require('@cortex/some-module/src/something');
```

### Build

Run `cortex install` and then webpack directly.

```bash
#!/usr/bin/env bash
cortex install
webpack
```