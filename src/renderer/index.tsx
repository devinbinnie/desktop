// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import 'renderer/css/index.scss';

import React from 'react';
import ReactDOM from 'react-dom';

import {CombinedConfig, Team} from 'types/config';

import {GET_CONFIGURATION, UPDATE_TEAMS, QUIT, RELOAD_CONFIGURATION, OPEN_APP_MENU} from 'common/communication';

import MainPage from './components/MainPage';
import MattermostApp from './mattermost';
import IntlProvider from './intl_provider';

import {browserHistory} from './browser_history';

type State = {
    config?: CombinedConfig;
}

class Root extends React.PureComponent<Record<string, never>, State> {
    registry?: {
        getComponent: (name: string) => any;
        setComponent: (name: string, component: any) => boolean;
    };

    constructor(props: Record<string, never>) {
        super(props);
        this.state = {};
    }

    async componentDidMount() {
        this.registry = await import('mattermost_webapp/registry');
        this.registry?.setComponent('utils/browser_history', browserHistory);
        await this.setInitialConfig();

        window.ipcRenderer.on('synchronize-config', () => {
            this.reloadConfig();
        });

        window.ipcRenderer.on(RELOAD_CONFIGURATION, () => {
            this.reloadConfig();
        });

        // Deny drag&drop navigation in mainWindow.
        // Drag&drop is allowed in webview of index.html.
        document.addEventListener('dragover', (event) => event.preventDefault());
        document.addEventListener('drop', (event) => event.preventDefault());
    }

    setInitialConfig = async () => {
        const config = await this.requestConfig(true);
        this.setState({config});
    }

    moveTabs = (teamName: string, originalOrder: number, newOrder: number): number | undefined => {
        if (!this.state.config) {
            throw new Error('No config');
        }
        const teams = this.state.config.teams.concat();
        const currentTeamIndex = teams.findIndex((team) => team.name === teamName);
        const tabs = teams[currentTeamIndex].tabs.concat();

        const tabOrder = tabs.map((team, index) => {
            return {
                index,
                order: team.order,
            };
        }).sort((a, b) => (a.order - b.order));

        const team = tabOrder.splice(originalOrder, 1);
        tabOrder.splice(newOrder, 0, team[0]);

        let teamIndex: number | undefined;
        tabOrder.forEach((t, order) => {
            if (order === newOrder) {
                teamIndex = t.index;
            }
            tabs[t.index].order = order;
        });
        teams[currentTeamIndex].tabs = tabs;
        this.setState({
            config: {
                ...this.state.config,
                teams,
            },
        });
        this.teamConfigChange(teams);
        return teamIndex;
    };

    teamConfigChange = async (updatedTeams: Team[]) => {
        window.ipcRenderer.invoke(UPDATE_TEAMS, updatedTeams).then(() => {
            this.reloadConfig();
        });
    };

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

    openMenu = () => {
        if (window.process.platform !== 'darwin') {
            window.ipcRenderer.send(OPEN_APP_MENU);
        }
    }

    render() {
        const {config} = this.state;
        if (!config) {
            return null;
        }
        return (
            <IntlProvider>
                <MainPage
                    teams={config.teams}
                    lastActiveTeam={config.lastActiveTeam}
                    moveTabs={this.moveTabs}
                    openMenu={this.openMenu}
                    darkMode={config.darkMode}
                    appName={config.appName}
                    useNativeWindow={config.useNativeWindow}
                />
            </IntlProvider>
        );
    }
}
window.ipcRenderer.invoke('get-app-version').then(({name, version}) => {
    // eslint-disable-next-line no-undef
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    console.log(`Starting ${name} v${version}${__HASH_VERSION__ ? ` commit: ${__HASH_VERSION__}` : ''}`);
});

ReactDOM.render(
    <Root/>,
    document.getElementById('app'),
);

ReactDOM.render(
    <MattermostApp/>,
    document.getElementById('root'),
);
