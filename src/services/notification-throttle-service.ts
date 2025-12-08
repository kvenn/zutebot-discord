import { Logger } from './logger.js';

/**
 * Service to throttle notifications and prevent spam.
 * Tracks when notifications were last sent for specific user+context combinations.
 */
export class NotificationThrottleService {
    private notificationHistory: Map<string, number> = new Map();
    private readonly throttleWindowMs: number;
    private cleanupIntervalId: NodeJS.Timeout | null = null;

    /**
     * @param throttleWindowMinutes - How long to wait between notifications for the same context (default: 30 minutes)
     * @param cleanupIntervalMinutes - How often to clean up old entries (default: 5 minutes)
     */
    constructor(
        throttleWindowMinutes: number = 30,
        private cleanupIntervalMinutes: number = 5
    ) {
        this.throttleWindowMs = throttleWindowMinutes * 60 * 1000;
    }

    /**
     * Start the automatic cleanup process
     */
    public startCleanup(): void {
        if (this.cleanupIntervalId) {
            return; // Already running
        }

        this.cleanupIntervalId = setInterval(
            () => {
                this.cleanup();
            },
            this.cleanupIntervalMinutes * 60 * 1000
        );

        Logger.info(
            `NotificationThrottleService: Cleanup scheduled every ${this.cleanupIntervalMinutes} minutes`
        );
    }

    /**
     * Stop the automatic cleanup process
     */
    public stopCleanup(): void {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
            Logger.info('NotificationThrottleService: Cleanup stopped');
        }
    }

    /**
     * Check if a notification should be sent for this user+context combination
     * @param userId - Discord user ID
     * @param guildId - Discord guild ID
     * @param context - Context identifier (e.g., "game:Battlefield", "voice:game-time")
     * @returns true if notification should be sent, false if throttled
     */
    public shouldNotify(userId: string, guildId: string, context: string): boolean {
        const key = this.buildKey(userId, guildId, context);
        const lastNotification = this.notificationHistory.get(key);

        if (!lastNotification) {
            return true; // No previous notification
        }

        const timeSinceLastNotification = Date.now() - lastNotification;
        const shouldNotify = timeSinceLastNotification >= this.throttleWindowMs;

        if (!shouldNotify) {
            const remainingMs = this.throttleWindowMs - timeSinceLastNotification;
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            Logger.info(
                `NotificationThrottleService: Throttled notification for user ${userId} in guild ${guildId} (context: ${context}). ${remainingMinutes} minutes remaining.`
            );
        }

        return shouldNotify;
    }

    /**
     * Record that a notification was sent for this user+context combination
     * @param userId - Discord user ID
     * @param guildId - Discord guild ID
     * @param context - Context identifier (e.g., "game:Battlefield", "voice:game-time")
     */
    public recordNotification(userId: string, guildId: string, context: string): void {
        const key = this.buildKey(userId, guildId, context);
        this.notificationHistory.set(key, Date.now());
    }

    /**
     * Remove expired entries from the notification history
     * Called automatically by the cleanup interval
     */
    private cleanup(): void {
        const now = Date.now();
        const expirationTime = now - this.throttleWindowMs;
        let removedCount = 0;

        for (const [key, timestamp] of this.notificationHistory.entries()) {
            if (timestamp < expirationTime) {
                this.notificationHistory.delete(key);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            Logger.info(
                `NotificationThrottleService: Cleaned up ${removedCount} expired entries. Current size: ${this.notificationHistory.size}`
            );
        }
    }

    /**
     * Build a unique key for the notification history map
     */
    private buildKey(userId: string, guildId: string, context: string): string {
        return `${userId}:${guildId}:${context}`;
    }

    /**
     * Get current statistics about the throttle service
     */
    public getStats(): { totalEntries: number; throttleWindowMinutes: number } {
        return {
            totalEntries: this.notificationHistory.size,
            throttleWindowMinutes: this.throttleWindowMs / 60000,
        };
    }

    /**
     * Clear all notification history (useful for testing)
     */
    public clear(): void {
        this.notificationHistory.clear();
        Logger.info('NotificationThrottleService: History cleared');
    }
}
