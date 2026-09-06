/**
 * Fábricas de campo compartilhadas pelos data models de ator e item.
 */

const fields = foundry.data.fields;

export const num = (initial, opts = {}) =>
  new fields.NumberField({ required: true, integer: true, initial, ...opts });

/** Igual ao num, mas aceita fração (multiplicadores, escalonamentos). */
export const dec = (initial, opts = {}) =>
  new fields.NumberField({ required: true, initial, ...opts });

export const str = (initial = "", opts = {}) =>
  new fields.StringField({ required: true, initial, ...opts });

/**
 * Nível que sobe pelo uso (SRD 3b e Magia): perícias, magias e técnicas
 * guardam o nível atual e quantas rolagens de cada classe já fizeram desde a
 * última subida. A tabela de quanto cada nível exige fica em PYRO.avancoPorUso,
 * escolhida pela trilha do item (ver progressao.mjs).
 * @param {number} nivelInicial 0 para perícia (aprende no primeiro avanço), 1 para magia e técnica.
 */
export const nivelPorUso = nivelInicial => new fields.SchemaField({
  nivel: num(nivelInicial, { min: 0 }),
  // Máximo comum é 15; raras habilidades estendem para 20.
  nivelMax: num(15, { min: 1 }),
  contadores: new fields.SchemaField({
    rotineiras: num(0, { min: 0 }),
    dificeis: num(0, { min: 0 }),
    muitoDificeis: num(0, { min: 0 })
  })
});
