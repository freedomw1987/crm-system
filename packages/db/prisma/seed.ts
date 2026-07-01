/**
 * Seed script for CRM System
 *
 * Populates database with:
 * - 1 admin user
 * - 3 sample companies
 * - 5 sample contacts
 * - 8 sample products
 * - 1 default pipeline with 6 stages
 * - 3 sample deals
 * - Sample activity logs
 *
 * Run: bun run db:seed
 */

import { PrismaClient, UserRole, ActivityType, DealStatus, ProductStatus, AddressType, QuotationStatus } from '@prisma/client';
// Bun.password.hash() uses Argon2id by default - no extra deps needed

// Load .env from project root (Prisma CLI does not auto-load .env in seed mode)
import { existsSync, readFileSync } from 'fs';
const envPath = '../../.env';
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf-8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Cleanup (in correct order due to FK constraints)
  await prisma.conversationMessage.deleteMany();
  await prisma.conversation.deleteMany();
  // Day 8+ schema rename: ActivityLog → Activity (+ Attachment)
  // Attachment must be deleted before Activity (FK onDelete: Cascade).
  await prisma.attachment.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.product.deleteMany();
  await prisma.pipelineStage.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.companyTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.address.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.rolePermission.deleteMany(); // Day 14: before user (User.roleId FK)
  await prisma.systemConfig.deleteMany();   // Day 14: SystemConfig (no FK chain to user yet, but for cleanliness)
  await prisma.role.deleteMany();           // Day 14: before user
  await prisma.user.deleteMany();

  // Day 14: seed Role + RolePermission rows from packages/shared/src/permissions.ts
  // source of truth. Without these, the rbac.ts middleware returns 0 permissions
  // for every user (P1-1 latent bug — `rbac.ts:64` reads from a table the seed
  // script never wrote to). This commit closes that gap AND adds the new
  // settings:* permissions for SystemConfig.
  // NOTE: must come BEFORE user creation because User.roleId → Role.id.
  const { PERMISSIONS } = await import('@crm/shared/permissions');
  const allPermissionKeys = Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>;
  // Role → permission subset (matches packages/shared/src/permissions.ts)
  const ROLE_PERMS: Record<string, string[]> = {
    ADMIN:  allPermissionKeys,                                // everything
    SALES:  ['company:read','company:create','company:update','company:delete',
             'contact:read','contact:create','contact:update','contact:delete',
             'product:read',
             'quotation:read','quotation:create','quotation:update','quotation:delete','quotation:send',
             'deal:read','deal:create','deal:update','deal:delete',
             'chat:use'],
    VIEWER: ['company:read','contact:read','product:read','quotation:read','deal:read'],
  };
  for (const roleName of ['ADMIN', 'SALES', 'VIEWER'] as const) {
    const role = await prisma.role.create({
      data: {
        name: roleName,
        displayName: roleName === 'ADMIN' ? 'Administrator' : roleName === 'SALES' ? 'Sales Rep' : 'Viewer',
        description: `System role — seeded from packages/shared/src/permissions.ts`,
        isSystem: true,
        permissions: {
          create: ROLE_PERMS[roleName].map((permission) => ({ permission })),
        },
      },
    });
    console.log(`✅ Created role ${role.name} (${ROLE_PERMS[roleName].length} permissions)`);
  }

  // 1. Create admin user
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const salesRole = await prisma.role.findUnique({ where: { name: 'SALES' } });
  const adminPassword = await Bun.password.hash('admin123');
  const admin = await prisma.user.create({
    data: {
      email: 'admin@crm.local',
      name: 'Admin User',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      roleId: adminRole?.id,
    },
  });
  console.log('✅ Created admin user:', admin.email);

  const salesPassword = await Bun.password.hash('sales123');
  const salesRep = await prisma.user.create({
    data: {
      email: 'sales@crm.local',
      name: 'Sales Rep',
      passwordHash: salesPassword,
      role: UserRole.SALES,
      roleId: salesRole?.id,
    },
  });
  console.log('✅ Created sales user:', salesRep.email);

  // 2. Create tags
  const tagVIP = await prisma.tag.create({
    data: { name: 'VIP', color: '#EF4444' },
  });
  const tagTech = await prisma.tag.create({
    data: { name: 'Technology', color: '#3B82F6' },
  });
  const tagManufacturing = await prisma.tag.create({
    data: { name: 'Manufacturing', color: '#10B981' },
  });
  console.log('✅ Created 3 tags');

  // 3. Create companies
  const acme = await prisma.company.create({
    data: {
      name: 'ACME Corporation',
      legalName: 'ACME Corp Ltd.',
      taxId: '12345678',
      industry: 'Manufacturing',
      website: 'https://acme.example.com',
      phone: '+852 2123 4567',
      email: 'info@acme.example.com',
      source: 'Referral',
      creditLimit: 100000,
      paymentTerms: 'Net 30',
      tags: {
        create: [
          { tagId: tagVIP.id },
          { tagId: tagManufacturing.id },
        ],
      },
    },
  });

  const techCorp = await prisma.company.create({
    data: {
      name: 'TechCorp Ltd',
      legalName: 'TechCorp Holdings Ltd',
      taxId: '87654321',
      industry: 'Technology',
      website: 'https://techcorp.example.com',
      phone: '+852 2876 5432',
      email: 'hello@techcorp.example.com',
      source: 'Website',
      creditLimit: 50000,
      paymentTerms: 'Net 60',
      tags: {
        create: [{ tagId: tagTech.id }],
      },
    },
  });

  const globex = await prisma.company.create({
    data: {
      name: 'Globex Industries',
      industry: 'Logistics',
      website: 'https://globex.example.com',
      phone: '+852 2345 6789',
      source: 'Cold Call',
      status: 'active',
    },
  });
  console.log('✅ Created 3 companies');

  // 4. Create addresses
  await prisma.address.create({
    data: {
      type: AddressType.OFFICE,
      line1: 'Unit 1208, Tower B',
      line2: '123 Business Bay',
      city: 'Hong Kong',
      country: 'HK',
      isDefault: true,
      companyId: acme.id,
    },
  });
  await prisma.address.create({
    data: {
      type: AddressType.BILLING,
      line1: '88 Commercial Road',
      city: 'Kowloon',
      country: 'HK',
      companyId: techCorp.id,
    },
  });
  console.log('✅ Created 2 addresses');

  // 5. Create contacts
  const johnAcme = await prisma.contact.create({
    data: {
      companyId: acme.id,
      firstName: 'John',
      lastName: 'Doe',
      title: 'CEO',
      email: 'john.doe@acme.example.com',
      phone: '+852 9123 4567',
      isPrimary: true,
    },
  });
  const maryAcme = await prisma.contact.create({
    data: {
      companyId: acme.id,
      firstName: 'Mary',
      lastName: 'Chen',
      title: 'Procurement Manager',
      email: 'mary.chen@acme.example.com',
      phone: '+852 9234 5678',
    },
  });
  await prisma.contact.create({
    data: {
      companyId: techCorp.id,
      firstName: 'David',
      lastName: 'Wong',
      title: 'CTO',
      email: 'david.wong@techcorp.example.com',
      mobile: '+852 9345 6789',
      isPrimary: true,
    },
  });
  await prisma.contact.create({
    data: {
      companyId: techCorp.id,
      firstName: 'Sarah',
      lastName: 'Lee',
      title: 'IT Director',
      email: 'sarah.lee@techcorp.example.com',
    },
  });
  await prisma.contact.create({
    data: {
      companyId: globex.id,
      firstName: 'Peter',
      lastName: 'Lam',
      title: 'Operations Director',
      email: 'peter.lam@globex.example.com',
      isPrimary: true,
    },
  });
  console.log('✅ Created 5 contacts');

  // 6. Create products
  const widgetA = await prisma.product.create({
    data: {
      sku: 'WID-A-001',
      name: 'Widget A - Standard',
      description: 'High-quality standard widget for industrial use',
      category: 'Widgets',
      unitPrice: 100.00,
      costPrice: 50.00,
      trackInventory: true,
      stockQuantity: 500,
      lowStockThreshold: 50,
      status: ProductStatus.ACTIVE,
    },
  });
  const widgetB = await prisma.product.create({
    data: {
      sku: 'WID-B-002',
      name: 'Widget B - Premium',
      description: 'Premium-grade widget with extended warranty',
      category: 'Widgets',
      unitPrice: 250.00,
      costPrice: 120.00,
      trackInventory: true,
      stockQuantity: 200,
      lowStockThreshold: 20,
      status: ProductStatus.ACTIVE,
    },
  });
  const consulting = await prisma.product.create({
    data: {
      sku: 'SVC-CONS-001',
      name: 'Consulting Hour',
      description: 'Senior consultant hourly rate',
      category: 'Services',
      unitPrice: 1500.00,
      trackInventory: false,
      status: ProductStatus.ACTIVE,
    },
  });
  const license = await prisma.product.create({
    data: {
      sku: 'LIC-ENT-001',
      name: 'Enterprise License (Annual)',
      description: 'Annual license for enterprise software',
      category: 'Software',
      unitPrice: 50000.00,
      costPrice: 5000.00,
      trackInventory: false,
      status: ProductStatus.ACTIVE,
    },
  });
  await prisma.product.create({
    data: {
      sku: 'HW-LAP-001',
      name: 'Laptop Pro 15"',
      description: 'High-performance laptop',
      category: 'Hardware',
      unitPrice: 18000.00,
      costPrice: 12000.00,
      trackInventory: true,
      stockQuantity: 50,
      lowStockThreshold: 10,
      status: ProductStatus.ACTIVE,
    },
  });
  await prisma.product.create({
    data: {
      sku: 'HW-MON-001',
      name: '27" 4K Monitor',
      description: 'Professional-grade 4K display',
      category: 'Hardware',
      unitPrice: 4500.00,
      costPrice: 3000.00,
      trackInventory: true,
      stockQuantity: 100,
      lowStockThreshold: 20,
      status: ProductStatus.ACTIVE,
    },
  });
  await prisma.product.create({
    data: {
      sku: 'SVC-INST-001',
      name: 'Installation Service',
      description: 'On-site installation and setup',
      category: 'Services',
      unitPrice: 3000.00,
      trackInventory: false,
      status: ProductStatus.ACTIVE,
    },
  });
  await prisma.product.create({
    data: {
      sku: 'ACC-CBL-001',
      name: 'USB-C Cable 2m',
      description: 'Premium USB-C charging cable',
      category: 'Accessories',
      unitPrice: 150.00,
      costPrice: 50.00,
      trackInventory: true,
      stockQuantity: 1000,
      status: ProductStatus.ACTIVE,
    },
  });
  console.log('✅ Created 8 products');

  // 7. Create default pipeline
  const pipeline = await prisma.pipeline.create({
    data: {
      name: 'Default Sales Pipeline',
      isDefault: true,
      stages: {
        create: [
          { name: 'Lead', position: 1, probability: 10, color: '#94A3B8' },
          { name: 'Qualified', position: 2, probability: 25, color: '#3B82F6' },
          { name: 'Proposal', position: 3, probability: 50, color: '#F59E0B' },
          { name: 'Negotiation', position: 4, probability: 75, color: '#F97316' },
          { name: 'Won', position: 5, probability: 100, color: '#10B981' },
          { name: 'Lost', position: 6, probability: 0, color: '#EF4444' },
        ],
      },
    },
    include: { stages: true },
  });
  console.log('✅ Created default pipeline with 6 stages');

  // 8. Create deals
  const stages = pipeline.stages;
  const leadStage = stages.find(s => s.position === 1)!;
  const proposalStage = stages.find(s => s.position === 3)!;
  const negotiationStage = stages.find(s => s.position === 4)!;

  await prisma.deal.create({
    data: {
      title: 'ACME Q4 Hardware Refresh',
      companyId: acme.id,
      ownerId: salesRep.id,
      pipelineId: pipeline.id,
      stageId: negotiationStage.id,
      status: DealStatus.OPEN,
      value: 120000,
      expectedCloseDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      description: 'Replace 50 workstations + peripherals',
    },
  });
  await prisma.deal.create({
    data: {
      title: 'TechCorp Enterprise Software License',
      companyId: techCorp.id,
      ownerId: salesRep.id,
      pipelineId: pipeline.id,
      stageId: proposalStage.id,
      status: DealStatus.OPEN,
      value: 50000,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      description: 'Annual enterprise license',
    },
  });
  await prisma.deal.create({
    data: {
      title: 'Globex Consulting Engagement',
      companyId: globex.id,
      ownerId: salesRep.id,
      pipelineId: pipeline.id,
      stageId: leadStage.id,
      status: DealStatus.OPEN,
      value: 75000,
      description: 'Process optimization consulting',
    },
  });
  console.log('✅ Created 3 deals');

  // 9. Create activity logs (Day 8+ schema: model Activity, content field, authorId required)
  await prisma.activity.createMany({
    data: [
      {
        type: ActivityType.CALL,
        content: 'Initial discovery call with ACME — Discussed Q4 hardware refresh. John mentioned budget approval needed by month-end.',
        companyId: acme.id,
        authorId: salesRep.id,
        assignedToId: salesRep.id,
      },
      {
        type: ActivityType.EMAIL,
        content: 'Sent proposal to TechCorp — Enterprise license proposal with 10% early-bird discount.',
        companyId: techCorp.id,
        authorId: salesRep.id,
      },
      {
        type: ActivityType.MEETING,
        content: 'On-site demo at ACME HQ — Product demo with 5 stakeholders. Strong interest in Widget B.',
        companyId: acme.id,
        authorId: salesRep.id,
      },
    ],
  });
  console.log('✅ Created 3 activity logs');

  // 10. Create one sample quotation
  await prisma.quotation.create({
    data: {
      number: 'Q-2026-0001',
      companyId: techCorp.id,
      createdById: salesRep.id,
      status: QuotationStatus.SENT,
      issueDate: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      sentAt: new Date(),
      subtotal: 54500,
      taxRate: 0,
      taxAmount: 0,
      total: 54500,
      title: 'TechCorp Enterprise License + Consulting',
      notes: 'Includes 20 hours of consulting',
      items: {
        create: [
          {
            productId: license.id,
            sku: license.sku,
            name: license.name,
            quantity: 1,
            unitPrice: 50000,
            lineTotal: 50000,
            position: 1,
          },
          {
            productId: consulting.id,
            sku: consulting.sku,
            name: consulting.name,
            quantity: 3,
            unitPrice: 1500,
            lineTotal: 4500,
            position: 2,
          },
        ],
      },
    },
  });
  console.log('✅ Created 1 sample quotation');

  // System Configuration defaults (Day 14+)
  // Seeded via upsert so re-running `bun run db:seed` doesn't wipe
  // admin's in-flight edits to these values.
  await prisma.systemConfig.upsert({
    where: { key: 'default_tax_rate' },
    update: {},
    create: {
      key: 'default_tax_rate',
      // Stored as a JSON number so the same column can later hold
      // e.g. { byRegion: { HK: 0, CN: 13 } } without a migration.
      value: 0,
      description: 'Default tax rate (%) applied to NEW quotations. Per-quotation override available; existing quotations keep their snapshot.',
    },
  });
  console.log('✅ Seeded system_config.default_tax_rate = 0%');

  // P2 multi-currency (2026-06-29): default currency + RMB-anchored
  // exchange rates. Seeded via upsert so re-running `bun run db:seed`
  // doesn't clobber admin's in-flight edits.
  //   - `default` — what new Quotation rows default to
  //   - `rates`   — two multipliers relative to RMB (1 RMB = X foreign)
  // The MOP→HKD rate is derived at save time as (RMB→HKD / RMB→MOP)
  // so the admin only needs to set two rates. If a future customer
  // needs to override the triangle (e.g. region-specific banking),
  // add a third key here and update the helper.
  await prisma.systemConfig.upsert({
    where: { key: 'currency_config' },
    update: {},
    create: {
      key: 'currency_config',
      value: {
        default: 'RMB',
        rates: { 'RMB->HKD': 1.08, 'RMB->MOP': 1.16 },
      },
      description: 'Default currency + RMB-anchored exchange rates used by Quotation. RMB→HKD and RMB→MOP are required; non-RMB currencies derive their HKD rate as RMB→HKD / RMB→<that>.',
    },
  });
  console.log('✅ Seeded system_config.currency_config = RMB (HKD 1.08, MOP 1.16)');

  // 2026-07-01 (US-MAINT-1): default Maintenance Service rate.
  // The Quotation builder's "＋維護費用" button creates a
  // SERVICE-typed line item priced at `project_subtotal × rate /
  // 100`. Stored as a JSON number 0..100 (percentage form) so the
  // admin input is intuitive — "20" means 20%, same convention as
  // the existing `default_tax_rate` row. Re-runs of `bun run
  // db:seed` are safe: upsert + `update: {}` means existing
  // admin edits are NOT clobbered.
  //
  // 2026-07-01 rename: 維修費用 → 維護費用 + "Maintenance Fee" →
  // "Maintenance Service" (per user request). The SystemConfig
  // key `maintenance_fee_rate` keeps its legacy identifier to
  // avoid breaking the stored DB row.
  await prisma.systemConfig.upsert({
    where: { key: 'maintenance_fee_rate' },
    update: {},
    create: {
      key: 'maintenance_fee_rate',
      value: 20,
      description: 'Maintenance Service rate as a percentage (project subtotal × rate / 100). Default 20 = 20%. Configurable in /settings/maintenance-fee.',
    },
  });
  console.log('✅ Seeded system_config.maintenance_fee_rate = 20% (Maintenance Service)');

  console.log('\n🎉 Seed complete!');
  console.log('\n📝 Login credentials:');
  console.log('   Admin:  admin@crm.local / admin123');
  console.log('   Sales:  sales@crm.local / sales123\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
