// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {Store} from 'redux';
import {Provider} from 'react-redux';
import {Router, Route} from 'react-router-dom';

import {GET_CONFIGURATION, QUIT, RELOAD_CONFIGURATION, SET_ACTIVE_VIEW} from 'common/communication';
import {CombinedConfig} from 'types/config';

import('mattermost_webapp/styles');

const LazyRoot = React.lazy(() => import('mattermost_webapp/root'));
const MattermostRoot = (props: any) => (
    <React.Suspense fallback={<div>{'Loading...'}</div>}>
        <LazyRoot {...props}/>
    </React.Suspense>
);
MattermostRoot.displayName = 'Root';

const updateWebsocket = (websocketURL: string) => {
    const NativeWebSocket = window.WebSocket;
    // eslint-disable-next-line func-names
    window.WebSocket = function(url: string) {
        return new NativeWebSocket(url.replace('file:///', websocketURL));
    };
};

type State = {
    config?: CombinedConfig;
    activeServerName?: string;
    activeTabName?: string;
}
export class MattermostApp extends React.PureComponent<Record<string, never>, State> {
    browserHistory: any;
    store?: Store<any>;

    constructor(props: Record<string, never>) {
        super(props);
        this.state = {};
    }

    async componentDidMount() {
        const registry = await import('mattermost_webapp/registry');
        this.browserHistory = registry.getComponent('utils/browser_history');
        this.store = (await import('mattermost_webapp/store')).default;
        await this.setInitialConfig();

        window.ipcRenderer.on('synchronize-config', () => {
            this.reloadConfig();
            this.updateWebsocketAddress();
        });

        window.ipcRenderer.on(RELOAD_CONFIGURATION, () => {
            this.reloadConfig();
            this.updateWebsocketAddress();
        });

        window.ipcRenderer.on(SET_ACTIVE_VIEW, (event, serverName, tabName) => {
            this.setState({activeServerName: serverName, activeTabName: tabName}, () => {
                this.updateWebsocketAddress();
            });
        });
    }

    updateWebsocketAddress = () => {
        if (!(this.state.config && this.state.activeServerName)) {
            return;
        }

        const serverURL = this.state.config.teams.find((team) => team.name === this.state.activeServerName)?.url;
        if (!serverURL) {
            return;
        }

        const websocketURL = serverURL.replace(/^http(s*):(.+)/g, 'ws$1:$2/');
        console.log('fixed websocket address', websocketURL);
        updateWebsocket(websocketURL);
    }

    setInitialConfig = async () => {
        const config = await this.requestConfig(true);
        this.setState({config});
        return config;
    }

    reloadConfig = async () => {
        const config = await this.requestConfig();
        this.setState({config});
    };

    requestConfig = async (exitOnError?: boolean) => {
        // todo: should we block?
        try {
            const configRequest = await window.ipcRenderer.invoke(GET_CONFIGURATION);
            return configRequest;
        } catch (err: any) {
            console.log(`there was an error with the config: ${err}`);
            if (exitOnError) {
                window.ipcRenderer.send(QUIT, `unable to load configuration: ${err}`, err.stack);
            }
        }
        return null;
    };

    render() {
        if (!this.state.config) {
            return null;
        }

        if (!this.store || !this.browserHistory) {
            return null;
        }

        return (
            <Provider store={this.store}>
                <Router history={this.browserHistory}>
                    <Route
                        path='/'
                        component={MattermostRoot}
                    />
                </Router>
            </Provider>
        );
    }
}

export default MattermostApp;
