/**
 * Efeitos do PYRO — versão para o Foundry v14.
 *
 * O v14 refez a aplicação de efeitos: as mudanças moram em `system.changes`,
 * o modo numérico virou o `type` em texto ("add", "override"...), e a
 * aplicação passou a ser o par `shouldApplyChange` (portão por mudança, na
 * instância) + `applyChange` (a conta em si, estática). Os dois ajustes do
 * PYRO se encaixam um em cada metade.
 */
const ALVO_ANTIGO = /^system\.atributos\.(\w+)\.valor$/;

export class PyroActiveEffect extends ActiveEffect {
  /**
   * Efeito preso a itens não vale o tempo todo. Ele continua listado na ficha,
   * mas fora da conta dos atributos: quem consome é a rolagem daqueles itens
   * (ver ajustesDeAtributo e bonusDeDano em efeitos.mjs). Sem isso, um "+2 FOR
   * com a katana" valeria também de mãos vazias.
   */
  get isSuppressed() {
    if ((this.flags?.pyro?.alvosItem ?? []).length) return true;
    return super.isSuppressed ?? false;
  }

  /** O mesmo travamento, no portão que a pipeline nova consulta por mudança. */
  shouldApplyChange(change, options) {
    if ((this.flags?.pyro?.alvosItem ?? []).length) return false;
    return super.shouldApplyChange?.(change, options) ?? true;
  }

  /**
   * Aumento de atributo criado antes do construtor mirar `.bonus` aponta para
   * `.valor` e apagaria o número que o jogador digitou. O redirecionamento
   * acontece na hora de aplicar, sem mexer no que está gravado — e só no tipo
   * Somar: Substituir, Mínimo e Máximo falam do atributo inteiro ("este
   * monstro tem FOR 20"), e mandar isso para o bônus mudaria o sentido.
   */
  static applyChange(alvo, change, options) {
    if (change?.type === "add" && ALVO_ANTIGO.test(change.key)) {
      change = { ...change, key: change.key.replace(ALVO_ANTIGO, "system.atributos.$1.bonus") };
    }
    return super.applyChange(alvo, change, options);
  }
}
