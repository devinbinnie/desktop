// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
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

const MattermostApp = () => {
    const [store, setStore] = useState();

    useEffect(() => {
        import('mattermost_webapp/store').then((module) => {
            setStore(module.default);
        });
    }, []);

    if (!store || !browserHistory) {
        return null;
    }

    return (
        <Provider store={store}>
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
