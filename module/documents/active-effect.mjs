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

  /**
   * Prazo vencido no relógio do mundo. Quem apaga os efeitos com prazo é o
   * relógio do combate (ver tempo.mjs); isto cobre o que foi aplicado fora de
   * combate, onde ninguém passa turno: o efeito continua listado, mas para de
   * somar assim que o tempo do mundo passa por ele.
   */
  get #prazoVencido() {
    const d = this.duration;
    return !!d?.seconds && Number(d.remaining) <= 0;
  }

  get isSuppressed() {
    if (this.#presoAItem || this.#posturaInativa || this.#prazoVencido) return true;
    return super.isSuppressed ?? false;
  }

  /** O mesmo travamento, no portão que o Foundry consulta por mudança. */
  shouldApplyChange(change, options) {
    if (this.#presoAItem || this.#posturaInativa || this.#prazoVencido) return false;
    return super.shouldApplyChange?.(change, options) ?? true;
  }

  /**
   * As @variáveis dos valores de efeito, somando o que o item dono empresta:
   * @nvl é o nível do item que carrega o efeito (o do progresso, numa
   * técnica), então "@nvl * 2" numa habilidade escala sozinho quando ela
   * sobe. Só entra na aplicação — o valor guardado e a ficha do efeito
   * continuam mostrando "@nvl".
   */
  getReplacementData(baseData) {
    const dados = super.getReplacementData?.(baseData) ?? { ...(baseData ?? {}) };
    const sys = this.parent instanceof Item ? this.parent.system : null;
    if (sys) dados.nvl = Number(sys.progresso?.nivel ?? sys.nivel) || 0;
    return dados;
  }
}
