// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {EventEmitter} from 'events';

import {app, powerMonitor} from 'electron';

import {Logger} from 'common/log';

const log = new Logger('UserActivityMonitor');

/**
 * Monitors system idle time, listens for system events and fires status updates as needed
 */
export class UserActivityMonitor extends EventEmitter {
    isActive: boolean;
    idleTime: number;
    systemIdleTimeIntervalID: number;
    config: {
        updateFrequencyMs: number;
        inactiveThreshold: number;
    };

    constructor() {
        super();

        this.config = {
            updateFrequencyMs: 1 * 1000, // eslint-disable-line no-magic-numbers
            inactiveThreshold: 60 * 5, // eslint-disable-line no-magic-numbers
        };

        this.isActive = !['idle', 'locked'].includes(powerMonitor.getSystemIdleState(this.config.inactiveThreshold));
        this.idleTime = 0;
        this.systemIdleTimeIntervalID = -1;

        // Set to Away when the session deactivates or the computer is being locked, slept or shutdown
        powerMonitor.on('user-did-resign-active', () => this.setActivityState(false));
        powerMonitor.on('lock-screen', () => this.setActivityState(false));
        powerMonitor.on('suspend', () => this.setActivityState(false));
        powerMonitor.on('shutdown', () => this.setActivityState(false));

        // Set to Online when the computer is unlocked or the session reactivates
        powerMonitor.on('user-did-become-active', () => this.setActivityState(true));
        powerMonitor.on('unlock-screen', () => this.setActivityState(true));
    }

    get userIsActive() {
        return this.isActive;
    }

    get userIdleTime() {
        return this.idleTime;
    }

    /**
   * Begin monitoring system events and idle time at defined frequency
   *
   * @param {Object} config - overide internal configuration defaults
   * @param {number} config.updateFrequencyMs - internal update clock frequency for monitoring idleTime
   * @param {number} config.inactiveThreshold - the number of seconds that idleTime needs to reach to internally be considered inactive
   * @emits {error} emitted when method is called before the app is ready
   * @emits {error} emitted when this method has previously been called but not subsequently stopped
   */
    startMonitoring(config = {}) {
        log.debug('startMonitoring', config);

        if (!app.isReady()) {
            this.emit('error', new Error('UserActivityMonitor.startMonitoring can only be called after app is ready'));
            return;
        }

        if (this.systemIdleTimeIntervalID >= 0) {
            this.emit('error', new Error('User activity monitoring is already in progress'));
            return;
        }

        this.config = Object.assign({}, this.config, config);

        // Node typings don't map Timeout to number, but then clearInterval requires a number?
        this.systemIdleTimeIntervalID = setInterval(() => {
            try {
                this.updateIdleTime(powerMonitor.getSystemIdleTime());
            } catch (err) {
                log.error('Error getting system idle time:', err);
            }
        }, this.config.updateFrequencyMs) as unknown as number;
    }

    /**
   * Stop monitoring system events and idle time
   */
    stopMonitoring() {
        clearInterval(this.systemIdleTimeIntervalID);
    }

    /**
   * Updates internal idle time and sets internal user activity state
   *
   * @param {integer} idleTime
   * @private
   */
    updateIdleTime(idleTime: number) {
        this.idleTime = idleTime;
        if (idleTime > this.config.inactiveThreshold) { // eslint-disable-line no-magic-numbers
            this.setActivityState(false);
        } else if (!this.isActive) {
            this.setActivityState(true);
        }
    }

    /**
   * Updates user active state and conditionally triggers a status update
   *
   * @param {boolean} isActive
   * @param {boolean} isSystemEvent – indicates whether the update was triggered by a system event (log in/out, screesaver on/off etc)
   * @private
   */
    setActivityState(isActive = false, isSystemEvent = false) {
        // Don't update if it's already set
        if (this.isActive === isActive && !isSystemEvent) {
            return;
        }

        log.debug('setActivityState', isActive, isSystemEvent);

        this.isActive = isActive;
        this.sendStatusUpdate(isSystemEvent);
    }

    /**
   * Sends an update with user activity status and current system idle time
   *
   * @emits {status} emitted at regular, definable intervals providing an update on user active status and idle time
   * @private
   */
    sendStatusUpdate(isSystemEvent = false) {
        log.debug('sendStatusUpdate', isSystemEvent, this.isActive, this.idleTime);

        this.emit('status', {
            userIsActive: this.isActive,
            idleTime: this.idleTime,
            isSystemEvent,
        });
    }
}

const userActivityMonitor = new UserActivityMonitor();
export default userActivityMonitor;
