/**
 * Efeitos do PYRO.
 *
 * O único ajuste sobre o comportamento do Foundry é o destino dos aumentos de
 * atributo. O construtor passou a mirar `system.atributos.<x>.bonus`, para o
 * aumento aparecer como +X ao lado da base em vez de reescrever o número que o
 * jogador digitou. Efeitos criados antes disso miram `.valor`, e continuariam
 * apagando a base; aqui eles são redirecionados na hora de aplicar, sem mexer
 * no que está gravado.
 */
const ALVO_ANTIGO = /^system\.atributos\.(\w+)\.valor$/;

export class PyroActiveEffect extends ActiveEffect {
  apply(actor, change) {
    /*
     * Só o modo Somar é redirecionado. Substituir, Mínimo e Máximo falam do
     * atributo inteiro ("este monstro tem FOR 20"), e passar isso para o bônus
     * mudaria o sentido do efeito.
     */
    if (change.mode === CONST.ACTIVE_EFFECT_MODES.ADD && ALVO_ANTIGO.test(change.key)) {
      change = { ...change, key: change.key.replace(ALVO_ANTIGO, "system.atributos.$1.bonus") };
    }
    return super.apply(actor, change);
  }
}
