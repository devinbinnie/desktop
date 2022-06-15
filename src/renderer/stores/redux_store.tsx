// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Reducer} from 'react';
import {Store, AnyAction} from 'redux';

import {SET_ACTIVE_VIEW} from 'common/communication';
import {CombinedConfig} from 'types/config';

import reducerRegistry from 'reducer_registry';

class ReduxStore {
    stores: Map<string, Store<any>>;
    store?: Store<any>;
    config?: CombinedConfig;
    currentServerName?: string;
    configureStore?: () => Store<any>;
    replacementCallback?: (newStore?: Store<any>) => void;

    constructor() {
        this.stores = new Map();

        window.ipcRenderer.on(SET_ACTIVE_VIEW, this.handleSwitchView);
    }

    initialize = async (config: CombinedConfig) => {
        const module = await import('mattermost_webapp/store');
        this.configureStore = module.default;

        this.config = config;
        this.currentServerName = (config.teams.find((team) => team.order === config.lastActiveTeam) || config.teams.find((team) => team.order === 0))?.name;

        await reducerRegistry.initialize(this.currentServerName);
        this.store = this.configureStore?.();

        if (process.env.NODE_ENV !== 'production') { //eslint-disable-line no-process-env
            window.store = store;
        }
        return this.store;
    }

    setReplacementCallback = (callback: (newStore?: Store<any>) => void) => {
        this.replacementCallback = callback;
    }

    handleSwitchView = (_: any, serverName: string, tabName: string) => {
        this.replaceStore(serverName);
    }

    replaceStore = (serverName: string) => {
        if (!(this.currentServerName && this.store)) {
            return;
        }

        reducerRegistry.replaceRegistry(serverName);

        this.stores.set(this.currentServerName, this.store);
        this.store = this.stores.get(serverName) ?? this.configureStore?.();
        this.currentServerName = serverName;

        this.replacementCallback?.(this.store);
    }

    dispatch = (action: AnyAction) => {
        if (!this.store) {
            return undefined;
        }

        return this.store.dispatch(action);
    }

    getState = () => {
        if (!this.store) {
            return undefined;
        }

        return this.store.getState();
    }

    subscribe = (listener: () => void) => {
        if (!this.store) {
            return undefined;
        }

        return this.store.subscribe(listener);
    }

    replaceReducer = (nextReducer: Reducer<any, AnyAction>) => {
        if (!this.store) {
            return undefined;
        }

        return this.store.replaceReducer(nextReducer);
    };

    [Symbol.observable] = () => {
        if (!this.store) {
            return undefined;
        }

        return this.store[Symbol.observable];
    }
}

const store = new ReduxStore();
export default store;
