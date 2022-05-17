// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Reducer} from 'react';
import {Store, AnyAction} from 'redux';

class ReduxStore {
    store?: Store<any>;

    loadStore = async () => {
        const module = await import('mattermost_webapp/store');
        this.store = module.default;
        if (process.env.NODE_ENV !== 'production') { //eslint-disable-line no-process-env
            window.store = store;
        }
        return store;
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
    }

    [Symbol.observable] = () => {
        if (!this.store) {
            return undefined;
        }

        return this.store[Symbol.observable];
    }
}

const store = new ReduxStore();
export default store;
