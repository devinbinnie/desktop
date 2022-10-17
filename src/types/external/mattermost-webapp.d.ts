// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
declare module 'mattermost_webapp/root' {
    const Root: React.ComponentType;

    export default Root;
}

declare module 'mattermost_webapp/crtWatcher' {
    const CrtPostsWatcher: React.ComponentType;

    export default CrtPostsWatcher;
}

declare module 'mattermost_webapp/registry' {
    export const getModule: (name: string) => unknown;
    export const setModule: (name: string, component: unknown) => boolean;
}

declare module 'mattermost_webapp/store' {
    const store: Store<any>;

    export default store;
}

declare module 'mattermost_webapp/styles';
declare module 'history';
