// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {Provider} from 'react-redux';
import {Router, Route} from 'react-router-dom';
import {browserHistory} from 'utils/browser_history';

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

type Props = {
    store: any;
}

const MattermostApp = (props: Props) => {
    if (!props.store || !browserHistory) {
        return null;
    }

    return (
        <Provider store={props.store}>
            <Router history={browserHistory}>
                <Route
                    path='/'
                    component={MattermostRoot}
                />
            </Router>
        </Provider>
    );
};

export default MattermostApp;
