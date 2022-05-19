// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Reducer} from 'redux';

class ReducerRegistry {
    registries: Map<string, any>
    RegistryClass?: any;
    currentServerName?: string;
    currentRegistry?: any;

    constructor() {
        this.registries = new Map();
    }

    initialize = async (serverName: string) => {
        const module = await import('mattermost_webapp/reducerRegistry');
        this.RegistryClass = module.ReducerRegistry;

        this.currentServerName = serverName;
        this.currentRegistry = new this.RegistryClass();
    }

    replaceRegistry = (serverName: string) => {
        if (!(this.currentServerName && this.currentRegistry)) {
            return;
        }

        this.registries.set(this.currentServerName, this.currentRegistry);
        this.currentRegistry = this.registries.get(serverName) ?? new this.RegistryClass();
        this.currentServerName = serverName;
    }

    setReducers = (reducers: Record<string, Reducer>): void => {
        if (!this.currentRegistry) {
            return;
        }

        this.currentRegistry.setReducer(reducers);
    }

    getReducers = (): Record<string, Reducer> => {
        if (!this.currentRegistry) {
            return {};
        }

        return this.currentRegistry.getReducers();
    }

    register = (name: string, reducer: Reducer): void => {
        if (!this.currentRegistry) {
            return;
        }

        this.currentRegistry.register(name, reducer);
    }

    setChangeListener = (listener: (reducers: Record<string, Reducer>) => void): void => {
        if (!this.currentRegistry) {
            return;
        }

        this.currentRegistry.setChangeListener(listener);
    }
}

const reducerRegistry = new ReducerRegistry();
export default reducerRegistry;
