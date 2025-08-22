import * as vscode from 'vscode';
import { Feature, FeatureTier, FEATURE_MATRIX } from './features';

export interface License {
  key: string;
  tier: FeatureTier;
  email: string;
  expiresAt?: Date;
  seats?: number;
  metadata?: Record<string, any>;
}

export class LicenseManager {
  private license: License | null = null;
  private context: vscode.ExtensionContext;
  private cache = new Map<string, boolean>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async initialize(): Promise<void> {
    console.log('Initializing license manager...');
    // Load license from secure storage
    const key = await this.context.secrets.get('sidekiq.licenseKey');
    console.log('Stored license key found:', key ? key.substring(0, 10) + '...' : 'none');
    if (key) {
      try {
        await this.activateLicense(key);
      } catch (error) {
        console.error('Failed to activate stored license:', error);
      }
    }
    console.log('License manager initialization complete. Current tier:', this.getCurrentTier());
  }

  async activateLicense(key: string): Promise<void> {
    try {
      // TODO: Validate with license server
      // For now, use a mock validation
      const license = await this.validateLicenseKey(key);
      
      this.license = license;
      
      // Store in secure storage
      await this.context.secrets.store('sidekiq.licenseKey', key);
      
      // Clear feature cache
      this.cache.clear();
      
      // Notify UI to refresh
      vscode.commands.executeCommand('sidekiq.refreshUI');
      
      console.log(`License activated successfully: ${license.tier} tier for ${license.email}`);
      vscode.window.showInformationMessage(`License activated: ${license.tier} tier`);
    } catch (error: any) {
      console.error('License activation failed:', error);
      throw new Error(`Invalid license: ${error.message}`);
    }
  }

  async deactivateLicense(): Promise<void> {
    this.license = null;
    await this.context.secrets.delete('sidekiq.licenseKey');
    this.cache.clear();
    vscode.commands.executeCommand('sidekiq.refreshUI');
  }

  canUseFeature(feature: Feature): boolean {
    // Check cache first
    if (this.cache.has(feature)) {
      return this.cache.get(feature)!;
    }
    
    // Get required tier for feature
    const requiredTier = FEATURE_MATRIX[feature];
    
    // Get current tier
    const currentTier = this.getCurrentTier();
    
    // Check if current tier meets requirement
    const allowed = this.tierMeetsRequirement(currentTier, requiredTier);
    
    // Cache result
    this.cache.set(feature, allowed);
    
    return allowed;
  }

  getCurrentTier(): FeatureTier {
    return this.license?.tier || FeatureTier.FREE;
  }

  getCurrentLicense(): License | null {
    return this.license;
  }

  isLicensed(): boolean {
    return this.license !== null && this.license.tier !== FeatureTier.FREE;
  }

  getMaxServerConnections(): number {
    const tier = this.getCurrentTier();
    switch (tier) {
      case FeatureTier.FREE:
        return 1;
      case FeatureTier.PRO:
        return 5;
      case FeatureTier.TEAM:
      case FeatureTier.ENTERPRISE:
        return 999; // Effectively unlimited
      default:
        return 1;
    }
  }

  getMaxJobHistory(): number {
    const tier = this.getCurrentTier();
    switch (tier) {
      case FeatureTier.FREE:
        return 100;
      case FeatureTier.PRO:
        return 1000;
      case FeatureTier.TEAM:
      case FeatureTier.ENTERPRISE:
        return 10000;
      default:
        return 100;
    }
  }

  getRefreshInterval(): number {
    const tier = this.getCurrentTier();
    switch (tier) {
      case FeatureTier.FREE:
        return 30000; // 30 seconds
      case FeatureTier.PRO:
        return 5000; // 5 seconds
      case FeatureTier.TEAM:
      case FeatureTier.ENTERPRISE:
        return 1000; // 1 second
      default:
        return 30000;
    }
  }

  private tierMeetsRequirement(current: FeatureTier, required: FeatureTier): boolean {
    const tierOrder = [
      FeatureTier.FREE,
      FeatureTier.PRO,
      FeatureTier.TEAM,
      FeatureTier.ENTERPRISE
    ];
    return tierOrder.indexOf(current) >= tierOrder.indexOf(required);
  }

  private async validateLicenseKey(key: string): Promise<License> {
    // Hardcoded enterprise key for all features
    const ENTERPRISE_KEY = '11e2461b60dc5a8c2b88f97f4e46a4e166b2009e3982fc47c30e1c457ef370b14cef47622e2a71436d98f177bd4362543d7138f565a225e7264c8c0f02f9f351';
    
    console.log(`Validating license key: ${key.substring(0, 10)}...`);
    console.log(`Expected enterprise key: ${ENTERPRISE_KEY.substring(0, 10)}...`);
    console.log(`Key match: ${key === ENTERPRISE_KEY}`);
    
    if (key === ENTERPRISE_KEY) {
      console.log('Enterprise license key validated successfully');
      return {
        key,
        tier: FeatureTier.ENTERPRISE,
        email: 'enterprise@sidekiq-manager.com',
        expiresAt: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // 10 years
        seats: 999,
        metadata: { unlocked: 'all_features' }
      };
    }
    
    // TODO: Implement actual license server validation
    // Mock implementation for development
    
    // Parse mock license key format: TIER-EMAIL-XXXX
    const parts = key.split('-');
    if (parts.length < 3) {
      throw new Error('Invalid license key format');
    }

    const tierMap: Record<string, FeatureTier> = {
      'PRO': FeatureTier.PRO,
      'TEAM': FeatureTier.TEAM,
      'ENTERPRISE': FeatureTier.ENTERPRISE
    };

    const tier = tierMap[parts[0]] || FeatureTier.FREE;
    const email = parts[1] + '@example.com';

    return {
      key,
      tier,
      email,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      seats: tier === FeatureTier.TEAM ? 5 : 1
    };
  }
}