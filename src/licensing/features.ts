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

export const TIER_NAMES: Record<FeatureTier, string> = {
  [FeatureTier.FREE]: 'Community',
  [FeatureTier.PRO]: 'Professional',
  [FeatureTier.TEAM]: 'Business',
  [FeatureTier.ENTERPRISE]: 'Enterprise'
};

export const TIER_LIMITS = {
  [FeatureTier.FREE]: {
    servers: 1,
    jobHistory: 100,
    bulkOperations: 10,
    refreshInterval: 30,
    dataRetention: 0
  },
  [FeatureTier.PRO]: {
    servers: 5,
    jobHistory: 1000,
    bulkOperations: 100,
    refreshInterval: 5,
    dataRetention: 7
  },
  [FeatureTier.TEAM]: {
    servers: 999,
    jobHistory: 10000,
    bulkOperations: 1000,
    refreshInterval: 1,
    dataRetention: 30
  },
  [FeatureTier.ENTERPRISE]: {
    servers: 999,
    jobHistory: 999999,
    bulkOperations: 999999,
    refreshInterval: 1,
    dataRetention: 365
  }
};