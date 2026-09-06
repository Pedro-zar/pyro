/**
 * Efeitos do PYRO: trava a aplicação dos efeitos que não valem o tempo todo —
 * os presos a itens e os de uma postura que não está ativa. No Foundry v14 a
 * aplicação passa por `shouldApplyChange` (portão por mudança, na instância) e
 * `applyChange` (a conta em si, estática); o travamento vai no portão.
 */
import { flagsDe, SYSTEM_ID } from "../sistema.mjs";

export class PyroActiveEffect extends ActiveEffect {
  /**
   * Efeito preso a itens não vale o tempo todo. Ele continua listado na ficha,
   * mas fora da conta dos atributos: quem consome é a rolagem daqueles itens
   * (ver ajustesDeAtributo e bonusDeDano em efeitos.mjs); senão um "+2 FOR
   * com a katana" valeria também de mãos vazias.
   */
  get #presoAItem() {
    return (flagsDe(this)?.alvosItem ?? []).length > 0;
  }

  /**
   * Efeito de uma postura só vale enquanto ela é a postura ativa (SRD
   * Técnicas). A postura é escolhida no ator, então a pergunta é feita de
   * fora do item: a habilidade não sabe se é a guarda do momento.
   */
  get #posturaInativa() {
    const item = this.parent;
    if (item?.documentName !== "Item" || !item.system?.ehPostura) return false;
    return item.actor?.getFlag(SYSTEM_ID, "postura") !== item.id;
  }

  get isSuppressed() {
    if (this.#presoAItem || this.#posturaInativa) return true;
    return super.isSuppressed ?? false;
  }

  /** O mesmo travamento, no portão que o Foundry consulta por mudança. */
  shouldApplyChange(change, options) {
    if (this.#presoAItem || this.#posturaInativa) return false;
    return super.shouldApplyChange?.(change, options) ?? true;
  }
}
