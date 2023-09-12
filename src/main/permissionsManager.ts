// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {PermissionRequestHandlerHandlerDetails, WebContents, app, dialog, ipcMain} from 'electron';

import {UPDATE_PATHS} from 'common/communication';
import JsonFileManager from 'common/JsonFileManager';
import {Logger} from 'common/log';
import {t} from 'common/utils/util';
import {isTrustedURL, parseURL} from 'common/utils/url';

import {permissionsJson} from 'main/constants';
import {localizeMessage} from 'main/i18nManager';
import ViewManager from 'main/views/viewManager';
import CallsWidgetWindow from 'main/windows/callsWidgetWindow';
import MainWindow from 'main/windows/mainWindow';

const log = new Logger('PermissionsManager');

// supported permission types
const supportedPermissionTypes = [
    'media',
    'geolocation',
    'notifications',
    'fullscreen',
    'openExternal',
    'clipboard-sanitized-write',
];

// permissions that require a dialog
const authorizablePermissionTypes = [
    'media',
    'geolocation',
    'notifications',
];

type Permissions = {
    [origin: string]: {
        [permission: string]: {
            allowed: boolean;
            alwaysDeny?: boolean;
        };
    };
};

export class PermissionsManager extends JsonFileManager<Permissions> {
    handlePermissionRequest = async (
        webContents: WebContents,
        permission: string,
        callback: (granted: boolean) => void,
        details: PermissionRequestHandlerHandlerDetails,
    ) => {
        const requestingURL = details.securityOrigin ?? details.requestingUrl;
        log.debug('handlePermissionRequest', requestingURL, permission);

        // is the requested permission type supported?
        if (!supportedPermissionTypes.includes(permission)) {
            callback(false);
            return;
        }

        // allow if the request is coming from the local renderer process instead of the remote one
        const mainWindow = MainWindow.get();
        if (mainWindow && webContents.id === mainWindow.webContents.id) {
            callback(true);
            return;
        }

        const parsedURL = parseURL(requestingURL);
        if (!parsedURL) {
            callback(false);
            return;
        }

        let serverURL;
        if (CallsWidgetWindow.isCallsWidget(webContents.id)) {
            serverURL = CallsWidgetWindow.getViewURL();
        } else {
            serverURL = ViewManager.getViewByWebContentsId(webContents.id)?.view.server.url;
        }

        if (!serverURL) {
            callback(false);
            return;
        }

        // is the requesting url trusted?
        if (!isTrustedURL(parsedURL, serverURL)) {
            callback(false);
            return;
        }

        // For certain permission types, we need to confirm with the user
        if (authorizablePermissionTypes.includes(permission)) {
            const currentPermission = this.json[parsedURL.origin]?.[permission];

            // If previously allowed, just allow
            if (currentPermission?.allowed) {
                callback(true);
                return;
            }

            // If denied permanently, deny
            if (currentPermission?.alwaysDeny) {
                callback(false);
                return;
            }

            if (!mainWindow) {
                callback(false);
                return;
            }

            // Show the dialog to ask the user
            const {response} = await dialog.showMessageBox(mainWindow, {
                title: localizeMessage('main.permissionsManager.checkPermission.dialog.title', 'Permission Requested'),
                message: localizeMessage(`main.permissionsManager.checkPermission.dialog.${permission}`, 'The {appName} application at {url} is requesting the "{permission}" permission.', {appName: app.name, url: parsedURL.origin, permission}),
                detail: localizeMessage('main.permissionsManager.checkPermission.dialog.detail', 'Would you like to grant the application this permission?'),
                type: 'question',
                buttons: [
                    localizeMessage('label.allow', 'Allow'),
                    localizeMessage('label.deny', 'Deny'),
                    localizeMessage('label.denyPermanently', 'Deny Permanently'),
                ],
            });

            // Save their response
            const newPermission = {
                allowed: response === 0,
                alwaysDeny: (response === 2) ? true : undefined,
            };
            this.json[parsedURL.origin] = {
                ...this.json[parsedURL.origin],
                [permission]: newPermission,
            };
            this.writeToFile();

            if (response > 0) {
                callback(false);
                return;
            }
        }

        // We've checked everything so we're okay to grant the remaining cases
        callback(true);
    }
}

t('main.permissionsManager.checkPermission.dialog.media');
t('main.permissionsManager.checkPermission.dialog.geolocation');
t('main.permissionsManager.checkPermission.dialog.notifications');

let permissionsManager = new PermissionsManager(permissionsJson);

ipcMain.on(UPDATE_PATHS, () => {
    permissionsManager = new PermissionsManager(permissionsJson);
});

export default permissionsManager;
