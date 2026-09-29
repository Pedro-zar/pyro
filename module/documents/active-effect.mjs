/**
 * Efeitos do PYRO: trava a aplicação dos efeitos que não valem o tempo todo —
 * os presos a itens, os de um equipamento guardado e os de uma postura ou
 * transformação que não está ativa. No Foundry v14 a aplicação passa por
 * `shouldApplyChange` (portão por mudança, na instância) e `applyChange` (a
 * conta em si, estática); o travamento vai no portão.
 */
import {
  motivoDaPausa, presoAItem, variaveisDoEfeito, valorInteiroDaMudanca, chaveDaMudanca
} from "../regras-efeito.mjs";

export class PyroActiveEffect extends ActiveEffect {
  /**
   * Por que o efeito não vale agora (ver motivoDaPausa), contando também o
   * "desligado" e a restrição a itens. Null quando ele está valendo. É o que
   * o construtor mostra para quem quer saber por que um efeito não soma.
   */
  get situacao() {
    if (this.disabled) return "desligado";
    return motivoDaPausa(this) ?? (presoAItem(this) ? "presoAItem" : null);
  }

  get isSuppressed() {
    if (presoAItem(this) || motivoDaPausa(this)) return true;
    /*
     * O vencido do núcleo não vale para efeito de item: ele não tem relógio
     * (ver motivoDaPausa), e uma marca de vencido deixada ali por um prazo
     * antigo desligaria para sempre o que a habilidade faz.
     */
    if (this.parent?.documentName === "Item") return !!this.system?.isSuppressed;
    return super.isSuppressed ?? false;
  }

  /** O mesmo travamento, no portão que o Foundry consulta por mudança. */
  shouldApplyChange(change, options) {
    if (presoAItem(this) || motivoDaPausa(this)) return false;
    return super.shouldApplyChange?.(change, options) ?? true;
  }

  /**
   * As @variáveis dos valores de efeito: @nvl é o nível do item que carrega o
   * efeito, e @for, @sab... são os atributos sem efeitos, porque o total
   * ainda não existe quando os campos são alterados (ver atributosSemEfeitos).
   * Só entra na aplicação: o valor guardado continua mostrando "@nvl".
   *
   * Uma cópia, e não o objeto recebido: o núcleo entrega os mesmos dados a
   * todos os efeitos do ator, e escrever o @nvl de uma habilidade ali faria
   * todos os efeitos lerem o nível do último item preparado.
   */
  getReplacementData(baseData) {
    return { ...(baseData ?? {}), ...variaveisDoEfeito(this, { naFicha: true }) };
  }

  /**
   * Multiplicar os dados de uma reação vai para o multiplicador de dados, e
   * não para o campo de dados a mais (ver chaveDaMudanca).
   */
  static applyChange(targetDoc, change, options) {
    const chave = chaveDaMudanca(change.key, change.type);
    if (chave !== change.key) change = { ...change, key: chave };
    return super.applyChange(targetDoc, change, options);
  }

  /**
   * Mudança num campo inteiro com conta que não fecha em inteiro: vira a
   * substituição pelo valor já arredondado (ver valorInteiroDaMudanca).
   */
  static applyChangeField(targetDoc, change, options = {}) {
    const campo = options.field;
    if (campo instanceof foundry.data.fields.NumberField && campo.integer) {
      try {
        const delta = campo._castChangeDelta(change.value, options.replacementData ?? {});
        const atual = Number(foundry.utils.getProperty(targetDoc, change.key));
        const inteiro = valorInteiroDaMudanca(change.type, atual, Number(delta));
        if (inteiro !== null) change = { ...change, type: "override", value: inteiro };
      } catch {
        // Fórmula que não resolve: o núcleo avisa no console do jeito dele.
      }
    }
    return super.applyChangeField(targetDoc, change, options);
  }
}
