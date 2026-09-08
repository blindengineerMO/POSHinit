const rolePermissions = {
  viewer: ['dashboard:read', 'inventory:read', 'library:read', 'reports:read', 'schedules:read'],
  operator: [
    'dashboard:read', 'inventory:read', 'inventory:manage', 'library:read', 'library:manage',
    'reports:read', 'schedules:read', 'schedules:manage', 'runs:execute', 'vault:manage',
  ],
  approver: ['dashboard:read', 'inventory:read', 'library:read', 'reports:read', 'schedules:read', 'approvals:read', 'approvals:decide'],
  admin: ['*'],
}

export const supportedRoles = Object.keys(rolePermissions)

export function hasPermission(user, permission) {
  const permissions = rolePermissions[user?.role] || []
  return permissions.includes('*') || permissions.includes(permission)
}
