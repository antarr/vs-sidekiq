# Freemium Implementation Guide

## Feature Flag System

### Configuration Schema
```typescript
// src/licensing/features.ts
export enum FeatureTier {
  FREE = 'free',
  PRO = 'pro',
  TEAM = 'team',
  ENTERPRISE = 'enterprise'
}

export enum Feature {
  // Connection Features
  SINGLE_SERVER = 'single_server',
  MULTI_SERVER = 'multi_server',
  UNLIMITED_SERVERS = 'unlimited_servers',
  
  // Job Operations
  BASIC_JOB_OPS = 'basic_job_ops',
  BULK_OPERATIONS = 'bulk_operations',
  CROSS_SERVER_OPS = 'cross_server_ops',
  JOB_TEMPLATES = 'job_templates',
  
  // Analytics
  BASIC_METRICS = 'basic_metrics',
  ADVANCED_ANALYTICS = 'advanced_analytics',
  HISTORICAL_DATA = 'historical_data',
  CUSTOM_DASHBOARDS = 'custom_dashboards',
  
  // Automation
  WEBHOOKS = 'webhooks',
  SCHEDULED_REPORTS = 'scheduled_reports',
  AUTO_RETRY_POLICIES = 'auto_retry_policies',
  WORKFLOW_AUTOMATION = 'workflow_automation',
  
  // Team Features
  SHARED_PROFILES = 'shared_profiles',
  TEAM_WORKSPACES = 'team_workspaces',
  AUDIT_LOGS = 'audit_logs',
  USER_PERMISSIONS = 'user_permissions',
  
  // Enterprise
  SSO_INTEGRATION = 'sso_integration',
  RBAC = 'rbac',
  COMPLIANCE_REPORTS = 'compliance_reports',
  WHITE_LABEL = 'white_label'
}

export const FEATURE_MATRIX: Record<Feature, FeatureTier> = {
  [Feature.SINGLE_SERVER]: FeatureTier.FREE,
  [Feature.MULTI_SERVER]: FeatureTier.PRO,
  [Feature.UNLIMITED_SERVERS]: FeatureTier.TEAM,
  [Feature.BASIC_JOB_OPS]: FeatureTier.FREE,
  [Feature.BULK_OPERATIONS]: FeatureTier.PRO,
  [Feature.CROSS_SERVER_OPS]: FeatureTier.TEAM,
  [Feature.JOB_TEMPLATES]: FeatureTier.PRO,
  [Feature.BASIC_METRICS]: FeatureTier.FREE,
  [Feature.ADVANCED_ANALYTICS]: FeatureTier.TEAM,
  [Feature.HISTORICAL_DATA]: FeatureTier.TEAM,
  [Feature.CUSTOM_DASHBOARDS]: FeatureTier.PRO,
  [Feature.WEBHOOKS]: FeatureTier.TEAM,
  [Feature.SCHEDULED_REPORTS]: FeatureTier.TEAM,
  [Feature.AUTO_RETRY_POLICIES]: FeatureTier.PRO,
  [Feature.WORKFLOW_AUTOMATION]: FeatureTier.TEAM,
  [Feature.SHARED_PROFILES]: FeatureTier.TEAM,
  [Feature.TEAM_WORKSPACES]: FeatureTier.TEAM,
  [Feature.AUDIT_LOGS]: FeatureTier.TEAM,
  [Feature.USER_PERMISSIONS]: FeatureTier.TEAM,
  [Feature.SSO_INTEGRATION]: FeatureTier.ENTERPRISE,
  [Feature.RBAC]: FeatureTier.ENTERPRISE,
  [Feature.COMPLIANCE_REPORTS]: FeatureTier.ENTERPRISE,
  [Feature.WHITE_LABEL]: FeatureTier.ENTERPRISE
};
```

### License Manager Implementation
```typescript
// src/licensing/licenseManager.ts
export class LicenseManager {
  private license: License | null = null;
  private cache = new Map<string, boolean>();
  
  async initialize(): Promise<void> {
    // Load license from VS Code secure storage
    const key = await this.getStoredLicenseKey();
    if (key) {
      await this.activateLicense(key);
    }
  }
  
  async activateLicense(key: string): Promise<void> {
    try {
      // Validate with license server
      const response = await this.validateWithServer(key);
      this.license = response.license;
      
      // Store in secure storage
      await this.storeLicenseKey(key);
      
      // Clear feature cache
      this.cache.clear();
      
      // Notify UI to refresh
      vscode.commands.executeCommand('sidekiq.refreshUI');
    } catch (error) {
      throw new Error(`Invalid license: ${error.message}`);
    }
  }
  
  canUseFeature(feature: Feature): boolean {
    // Check cache first
    if (this.cache.has(feature)) {
      return this.cache.get(feature)!;
    }
    
    // Get required tier for feature
    const requiredTier = FEATURE_MATRIX[feature];
    
    // Get current tier
    const currentTier = this.license?.tier || FeatureTier.FREE;
    
    // Check if current tier meets requirement
    const allowed = this.tierMeetsRequirement(currentTier, requiredTier);
    
    // Cache result
    this.cache.set(feature, allowed);
    
    return allowed;
  }
  
  private tierMeetsRequirement(current: FeatureTier, required: FeatureTier): boolean {
    const tierOrder = [FeatureTier.FREE, FeatureTier.PRO, FeatureTier.TEAM, FeatureTier.ENTERPRISE];
    return tierOrder.indexOf(current) >= tierOrder.indexOf(required);
  }
}
```

## Usage Tracking Implementation

### Analytics Collector
```typescript
// src/telemetry/analytics.ts
export class AnalyticsCollector {
  private queue: AnalyticsEvent[] = [];
  private flushInterval = 60000; // 1 minute
  
  track(event: string, properties?: Record<string, any>): void {
    if (!this.isTrackingEnabled()) return;
    
    this.queue.push({
      event,
      properties: {
        ...properties,
        timestamp: Date.now(),
        version: this.getExtensionVersion(),
        tier: this.getCurrentTier()
      }
    });
    
    if (this.queue.length >= 100) {
      this.flush();
    }
  }
  
  trackFeatureUsage(feature: Feature): void {
    this.track('feature_used', {
      feature,
      allowed: licenseManager.canUseFeature(feature)
    });
  }
  
  trackUpgradeTrigger(trigger: string, fromTier: FeatureTier, toTier: FeatureTier): void {
    this.track('upgrade_trigger', {
      trigger,
      from_tier: fromTier,
      to_tier: toTier
    });
  }
  
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    
    const events = [...this.queue];
    this.queue = [];
    
    try {
      await this.sendToAnalyticsServer(events);
    } catch (error) {
      // Re-queue events on failure
      this.queue.unshift(...events);
    }
  }
}
```

## Upgrade Prompts System

### Smart Upgrade Triggers
```typescript
// src/ui/upgradeTriggers.ts
export class UpgradeTriggerManager {
  private readonly triggers = new Map<string, UpgradeTrigger>();
  
  registerTriggers(): void {
    // Connection limit trigger
    this.triggers.set('connection_limit', {
      condition: () => this.getServerCount() >= this.getMaxServers(),
      message: 'You\'ve reached your server limit. Upgrade to connect more servers.',
      targetTier: FeatureTier.PRO,
      cta: 'Upgrade to Pro'
    });
    
    // Bulk operation trigger
    this.triggers.set('bulk_operation', {
      condition: () => this.getSelectedJobCount() > 10,
      message: 'Select up to 100 jobs at once with Pro.',
      targetTier: FeatureTier.PRO,
      cta: 'Unlock Bulk Operations'
    });
    
    // Team sharing trigger
    this.triggers.set('team_share', {
      condition: () => this.isAttemptingShare(),
      message: 'Share dashboards and profiles with your team.',
      targetTier: FeatureTier.TEAM,
      cta: 'Enable Team Features'
    });
    
    // Historical data trigger
    this.triggers.set('historical_data', {
      condition: () => this.isRequestingHistoricalData(),
      message: 'Access 30 days of historical metrics with Team plan.',
      targetTier: FeatureTier.TEAM,
      cta: 'View Historical Data'
    });
  }
  
  async checkAndShowUpgrade(triggerId: string): Promise<void> {
    const trigger = this.triggers.get(triggerId);
    if (!trigger || !trigger.condition()) return;
    
    // Track the trigger
    analytics.trackUpgradeTrigger(triggerId, this.getCurrentTier(), trigger.targetTier);
    
    // Show upgrade prompt
    const action = await vscode.window.showInformationMessage(
      trigger.message,
      trigger.cta,
      'Learn More',
      'Not Now'
    );
    
    if (action === trigger.cta) {
      this.openUpgradePage(trigger.targetTier);
    } else if (action === 'Learn More') {
      this.openPricingPage();
    }
  }
}
```

## Payment Integration

### Stripe Integration
```typescript
// src/payments/stripe.ts
export class StripePaymentProvider {
  private stripe: Stripe;
  
  async createCheckoutSession(tier: FeatureTier, userId: string): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: this.getPriceId(tier),
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${CALLBACK_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CALLBACK_URL}/cancel`,
      metadata: {
        userId,
        extensionId: this.getExtensionId(),
        tier
      }
    });
    
    return session.url;
  }
  
  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object);
        break;
    }
  }
  
  private async handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
    const { userId, tier } = session.metadata;
    
    // Generate license key
    const licenseKey = await this.generateLicenseKey(userId, tier);
    
    // Send license key to user
    await this.emailLicenseKey(session.customer_email, licenseKey);
    
    // Activate in extension if same user
    if (this.isCurrentUser(userId)) {
      await licenseManager.activateLicense(licenseKey);
    }
  }
}
```

## UI Components for Freemium

### Tier Badge Component
```typescript
// src/ui/components/tierBadge.ts
export class TierBadge {
  render(): string {
    const tier = licenseManager.getCurrentTier();
    const color = this.getTierColor(tier);
    const icon = this.getTierIcon(tier);
    
    return `
      <div class="tier-badge" style="background: ${color}">
        <span class="tier-icon">${icon}</span>
        <span class="tier-name">${tier.toUpperCase()}</span>
        ${tier === FeatureTier.FREE ? 
          '<a href="#" class="upgrade-link">Upgrade</a>' : ''}
      </div>
    `;
  }
}
```

### Feature Gate Component
```typescript
// src/ui/components/featureGate.ts
export class FeatureGate {
  static wrap(feature: Feature, content: string): string {
    if (licenseManager.canUseFeature(feature)) {
      return content;
    }
    
    const requiredTier = FEATURE_MATRIX[feature];
    return `
      <div class="feature-locked">
        <div class="lock-overlay">
          <i class="fa fa-lock"></i>
          <p>This feature requires ${requiredTier} plan</p>
          <button class="upgrade-btn" data-tier="${requiredTier}">
            Upgrade to ${requiredTier}
          </button>
        </div>
        <div class="blurred-content">${content}</div>
      </div>
    `;
  }
}
```

## Server Limits Implementation

### Connection Limiter
```typescript
// src/core/connectionLimiter.ts
export class ConnectionLimiter {
  getMaxConnections(): number {
    const tier = licenseManager.getCurrentTier();
    switch (tier) {
      case FeatureTier.FREE:
        return 1;
      case FeatureTier.PRO:
        return 5;
      case FeatureTier.TEAM:
        return 999; // Effectively unlimited
      case FeatureTier.ENTERPRISE:
        return 999;
      default:
        return 1;
    }
  }
  
  canAddConnection(): boolean {
    const current = this.serverRegistry.getServerCount();
    const max = this.getMaxConnections();
    return current < max;
  }
  
  async enforceLimit(): Promise<void> {
    if (!this.canAddConnection()) {
      const upgrade = await vscode.window.showWarningMessage(
        `You've reached the maximum of ${this.getMaxConnections()} server connections for your plan.`,
        'Upgrade Plan',
        'Remove Server'
      );
      
      if (upgrade === 'Upgrade Plan') {
        await this.openUpgradePage();
      } else if (upgrade === 'Remove Server') {
        await this.showServerRemovalDialog();
      }
      
      throw new Error('Connection limit reached');
    }
  }
}
```

## Trial System

### Free Trial Implementation
```typescript
// src/licensing/trial.ts
export class TrialManager {
  private readonly TRIAL_DURATION = 14 * 24 * 60 * 60 * 1000; // 14 days
  
  async startTrial(tier: FeatureTier): Promise<void> {
    const trialData = {
      tier,
      startDate: Date.now(),
      endDate: Date.now() + this.TRIAL_DURATION,
      used: true
    };
    
    await this.storage.store('trial', trialData);
    await licenseManager.activateTrial(tier);
    
    // Schedule trial expiration reminder
    this.scheduleReminders(trialData.endDate);
  }
  
  isTrialActive(): boolean {
    const trial = this.storage.get('trial');
    return trial && Date.now() < trial.endDate;
  }
  
  getDaysRemaining(): number {
    const trial = this.storage.get('trial');
    if (!trial) return 0;
    
    const remaining = trial.endDate - Date.now();
    return Math.ceil(remaining / (24 * 60 * 60 * 1000));
  }
  
  private scheduleReminders(endDate: number): void {
    // 3 days before expiration
    setTimeout(() => {
      this.showExpirationWarning(3);
    }, endDate - Date.now() - (3 * 24 * 60 * 60 * 1000));
    
    // 1 day before expiration
    setTimeout(() => {
      this.showExpirationWarning(1);
    }, endDate - Date.now() - (24 * 60 * 60 * 1000));
    
    // On expiration
    setTimeout(() => {
      this.handleTrialExpiration();
    }, endDate - Date.now());
  }
}
```

## Revenue Tracking

### Usage Metrics Dashboard
```typescript
// src/admin/metrics.ts
export class MetricsDashboard {
  async getMetrics(): Promise<Metrics> {
    return {
      users: {
        total: await this.getTotalUsers(),
        free: await this.getUsersByTier(FeatureTier.FREE),
        pro: await this.getUsersByTier(FeatureTier.PRO),
        team: await this.getUsersByTier(FeatureTier.TEAM),
        enterprise: await this.getUsersByTier(FeatureTier.ENTERPRISE)
      },
      revenue: {
        mrr: await this.calculateMRR(),
        arr: await this.calculateARR(),
        ltv: await this.calculateLTV(),
        arpu: await this.calculateARPU()
      },
      conversion: {
        freeToProRate: await this.getConversionRate(FeatureTier.FREE, FeatureTier.PRO),
        proToTeamRate: await this.getConversionRate(FeatureTier.PRO, FeatureTier.TEAM),
        trialConversionRate: await this.getTrialConversionRate(),
        churnRate: await this.getChurnRate()
      },
      engagement: {
        dau: await this.getDailyActiveUsers(),
        wau: await this.getWeeklyActiveUsers(),
        mau: await this.getMonthlyActiveUsers(),
        featureAdoption: await this.getFeatureAdoptionRates()
      }
    };
  }
}
```

## Testing Freemium Features

### License Testing
```typescript
// src/test/licensing.test.ts
describe('License Manager', () => {
  it('should enforce free tier limits', async () => {
    const manager = new LicenseManager();
    await manager.setTier(FeatureTier.FREE);
    
    expect(manager.canUseFeature(Feature.SINGLE_SERVER)).toBe(true);
    expect(manager.canUseFeature(Feature.MULTI_SERVER)).toBe(false);
    expect(manager.canUseFeature(Feature.TEAM_WORKSPACES)).toBe(false);
  });
  
  it('should allow feature access after upgrade', async () => {
    const manager = new LicenseManager();
    await manager.setTier(FeatureTier.PRO);
    
    expect(manager.canUseFeature(Feature.MULTI_SERVER)).toBe(true);
    expect(manager.canUseFeature(Feature.BULK_OPERATIONS)).toBe(true);
  });
  
  it('should track feature usage attempts', async () => {
    const spy = jest.spyOn(analytics, 'trackFeatureUsage');
    
    featureGate.checkAccess(Feature.TEAM_WORKSPACES);
    
    expect(spy).toHaveBeenCalledWith(Feature.TEAM_WORKSPACES);
  });
});
```