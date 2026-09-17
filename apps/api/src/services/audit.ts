/**
 * Auditoria de ações sensíveis (§30, §56).
 *
 * O que se regista e porquê: alterações de password e de 2FA, criação e revogação de
 * sessões, exportações de dados, eliminação de conta e criação de integrações. São as
 * operações em que, se algo correr mal, o utilizador precisa de saber o que aconteceu
 * e quando. Não registamos navegação normal: um log de auditoria que regista tudo
 * deixa de ser consultável e transforma-se ele próprio num risco de privacidade (§31).
 *
 * Falhas de escrita em auditoria **não** devem fazer falhar a operação do utilizador,
 * mas têm de ficar visíveis nos logs do servidor.
 */

import { writeJson } from '../core/json.js';
import { logger } from '../core/logger.js';
import { prisma } from '../core/db.js';

export type AuditAction =
  | 'user.signup'
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.logout_all'
  | 'user.password_changed'
  | 'user.password_reset_requested'
  | 'user.password_reset_completed'
  | 'user.profile_updated'
  | 'user.preferences_updated'
  | 'user.2fa_setup_started'
  | 'user.2fa_enabled'
  | 'user.2fa_disabled'
  | 'user.2fa_recovery_used'
  | 'user.exported_data'
  | 'user.deleted_account'
  | 'session.created'
  | 'session.revoked'
  | 'vehicle.created'
  | 'vehicle.updated'
  | 'vehicle.deleted'
  | 'vehicle.archived'
  | 'odometer.corrected'
  | 'integration.created'
  | 'integration.updated'
  | 'integration.deleted'
  | 'record.deleted';

export interface AuditContext {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Escreve uma entrada de auditoria.
 *
 * Devolve sempre uma promessa resolvida: um erro de auditoria é registado e engolido.
 * A alternativa — deixar o utilizador sem conseguir mudar a password porque a tabela
 * de auditoria está cheia — é pior do que ter um registo em falta.
 */
export async function audit(
  action: AuditAction,
  options: AuditContext & {
    entityType?: string;
    entityId?: string;
    /** Metadados não sensíveis. Nunca incluir passwords, tokens ou dados pessoais. */
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: options.userId ?? null,
        action,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        metadata: writeJson(options.metadata ?? null),
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent?.slice(0, 255) ?? null,
      },
    });
  } catch (error) {
    logger.error('Não foi possível escrever a entrada de auditoria', {
      action,
      error,
      userId: options.userId ? 'presente' : 'ausente',
    });
  }
}
