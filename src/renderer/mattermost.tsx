// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {Store} from 'redux';
import {Provider} from 'react-redux';
import {Router, Route} from 'react-router-dom';
import {browserHistory} from 'utils/browser_history';

import {GET_CONFIGURATION, QUIT, RELOAD_CONFIGURATION} from 'common/communication';
import reduxStore from 'stores/redux_store.jsx';
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
updateWebsocket('wss://home.sourcestorm.net/mattermost/');

type State = {
    config?: CombinedConfig;
    store?: Store<any>;
}
export class MattermostApp extends React.PureComponent<Record<string, never>, State> {
    constructor(props: Record<string, never>) {
        super(props);
        this.state = {};
    }

    async componentDidMount() {
        const config = await this.setInitialConfig();
        await this.setInitialStore(config);
        reduxStore.setReplacementCallback(this.onReplaceStore);

        window.ipcRenderer.on('synchronize-config', () => {
            this.reloadConfig();
        });

        window.ipcRenderer.on(RELOAD_CONFIGURATION, () => {
            this.reloadConfig();
        });
    }

    setInitialStore = async (config: CombinedConfig) => {
        const store = await reduxStore.initialize(config);
        this.setState({store});
    }

    onReplaceStore = (newStore?: Store<any>) => {
        if (newStore) {
            this.setState({store: undefined}, () => {
                console.log('set back to root');
                browserHistory.push('/');
                this.setState({store: newStore});
            });
        }
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
        if (!this.state.store || !browserHistory) {
            return null;
        }

        return (
            <Provider store={this.state.store}>
                <Router history={browserHistory}>
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
