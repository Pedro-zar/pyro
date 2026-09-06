/**
 * Efeitos do PYRO: trava a aplicação dos efeitos presos a itens. No Foundry
 * v14 a aplicação passa por `shouldApplyChange` (portão por mudança, na
 * instância) e `applyChange` (a conta em si, estática); o travamento vai no portão.
 */
import { flagsDe } from "../sistema.mjs";

export class PyroActiveEffect extends ActiveEffect {
  /**
   * Efeito preso a itens não vale o tempo todo. Ele continua listado na ficha,
   * mas fora da conta dos atributos: quem consome é a rolagem daqueles itens
   * (ver ajustesDeAtributo e bonusDeDano em efeitos.mjs); senão um "+2 FOR
   * com a katana" valeria também de mãos vazias.
   */
  get isSuppressed() {
    if ((flagsDe(this)?.alvosItem ?? []).length) return true;
    return super.isSuppressed ?? false;
  }

  /** O mesmo travamento, no portão que o Foundry consulta por mudança. */
  shouldApplyChange(change, options) {
    if ((flagsDe(this)?.alvosItem ?? []).length) return false;
    return super.shouldApplyChange?.(change, options) ?? true;
  }
}
