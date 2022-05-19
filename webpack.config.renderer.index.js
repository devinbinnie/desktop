// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// This file uses CommonJS.
/* eslint-disable import/no-commonjs */
'use strict';

const path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');
const {merge} = require('webpack-merge');

const base = require('./webpack.config.base');

const deps = require('./package.json').dependencies;

const WEBSERVER_PORT = process.env.WEBSERVER_PORT ?? 9001;

module.exports = merge(base, {
    entry: {
        index: './src/renderer/index_bootstrap.ts',
    },
    resolve: {
        alias: {
            redux_store: './stores/redux_store.tsx',
            reducer_registry: 'renderer/reducer_registry.tsx',
        },
    },
    output: {
        path: path.resolve(__dirname, 'dist/renderer'),
        filename: '[name]_bundle.js',
        assetModuleFilename: '[name].[ext]',
    },
    plugins: [
        new webpack.container.ModuleFederationPlugin({
            name: 'index',
            remotes: {
                mattermost_webapp: `mattermost_webapp@${path.resolve(__dirname, '../mattermost-webapp/dist/remoteEntry.js')}`,
            },
            shared: {
                history: {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps.history,
                },
                'mattermost-redux/store/reducer_registry': {
                    singleton: true,
                    eager: true,
                    import: 'reducer_registry',
                },
                react: {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps.react,
                },
                'react-dom': {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps['react-dom'],
                },
                'react-redux': {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps['react-redux'],
                },
                'react-router': {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps['react-router'],
                },
                'react-router-dom': {
                    singleton: true,
                    eager: true,
                    requiredVersion: deps['react-router-dom'],
                },
                'stores/redux_store.jsx': {
                    singleton: true,
                    eager: true,
                    import: 'redux_store',
                },
                'utils/browser_history': {
                    singleton: true,
                    eager: true,
                    import: './src/renderer/browser_history.tsx',
                },
            },
        }),
        new HtmlWebpackPlugin({
            title: 'Mattermost Desktop App',
            template: 'src/renderer/index.html',
            chunks: ['index'],
            filename: 'index.html',
        }),
        new MiniCssExtractPlugin({
            filename: 'styles.[contenthash].css',
            ignoreOrder: true,
            chunkFilename: '[id].[contenthash].css',
        }),
    ],
    module: {
        rules: [{
            test: /\.(js|jsx|ts|tsx)?$/,
            use: {
                loader: 'babel-loader',
            },
        }, {
            test: /\.css$/,
            exclude: /\.lazy\.css$/,
            use: [
                MiniCssExtractPlugin.loader,
                'css-loader',
            ],
        }, {
            test: /\.lazy\.css$/,
            use: [
                {
                    loader: 'style-loader',
                    options: {
                        injectType: 'lazyStyleTag',
                    },
                },
                'css-loader',
            ],
        }, {
            test: /\.scss$/,
            use: [
                MiniCssExtractPlugin.loader,
                'css-loader',
                'sass-loader',
            ],
        }, {
            test: /\.mp3$/,
            type: 'asset/inline',
        }, {
            test: /\.(svg|gif)$/,
            type: 'asset/resource',
        }, {
            test: /\.(eot|ttf|woff|woff2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
            type: 'asset/resource',
        }],
    },
    node: {
        __filename: false,
        __dirname: false,
    },
    devServer: {
        port: WEBSERVER_PORT + 1,
    },
});

/* eslint-enable import/no-commonjs */
