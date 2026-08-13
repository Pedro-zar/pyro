import { PYRO } from "../config.mjs";
import { formulaTeste, expandirAtributos } from "../dados.mjs";

const { DialogV2 } = foundry.applications.api;

export class PyroActor extends Actor {
  /**
   * Personagens nascem com o token vinculado à ficha: arrastar a ficha pro
   * mapa já traz PV, mana e recursos calculados, e o dano aplicado no token
   * vale pra ficha inteira. NPCs seguem desvinculados, pra cada cópia do
   * mesmo inimigo ter a própria vida.
   */
  async _preCreate(data, options, user) {
    const permitido = await super._preCreate(data, options, user);
    if (permitido === false) return false;
    if (data.prototypeToken?.actorLink !== undefined) return;

    const personagem = this.type === "personagem";
    const escala = PYRO.tamanhos[this.system.tamanho]?.token ?? 1;
    this.updateSource({
      prototypeToken: {
        width: escala,
        height: escala,
        actorLink: personagem,
        disposition: personagem
          ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
          : CONST.TOKEN_DISPOSITIONS.HOSTILE,
        sight: { enabled: personagem }
      }
    });
  }

  /**
   * @for, @vig... = valor efetivo (MOD). @dados.for = fórmula da pool
   * (string, inline na Roll — é assim que a iniciativa "@dados.agi" funciona).
   */
  getRollData() {
    const data = { ...super.getRollData() };
    data.dados = {};
    for (const [chave, attr] of Object.entries(this.system.atributos ?? {})) {
      data[chave] = attr.efetivo;
      data.dados[chave] = attr.pool;
    }
    data.det = this.system.det;
    data.multi = this.system.multi;
    return data;
  }

  /**
   * Deixa o token do mesmo tamanho da criatura. Roda quando o tamanho muda
   * por raça, efeito ou edição direta; tokens já colocados só mudam se ainda
   * estiverem no tamanho anterior, para não desfazer ajuste manual do mestre.
   */
  async sincronizarTamanhoToken() {
    const escala = PYRO.tamanhos[this.system.tamanho]?.token;
    if (!escala) return;
    const anterior = this.prototypeToken.width;
    if (anterior === escala) return;
    // Um cliente só faz a atualização, senão todos disparam a mesma coisa.
    if (!(game.users.activeGM?.isSelf ?? game.user.isGM)) return;

    await this.update({
      "prototypeToken.width": escala,
      "prototypeToken.height": escala
    });

    for (const cena of game.scenes) {
      const alvos = cena.tokens.filter(t =>
        t.actorId === this.id && t.width === anterior && t.height === anterior
      );
      if (alvos.length) {
        await cena.updateEmbeddedDocuments("Token",
          alvos.map(t => ({ _id: t.id, width: escala, height: escala })));
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Testes de atributo                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Teste de atributo com diálogo (bônus, vantagem/desvantagem, ND,
   * Passar seus Limites). `rapido` pula o diálogo.
   */
  async rolarAtributo(chave, { rapido = false } = {}) {
    const attr = this.system.atributos?.[chave];
    if (!attr) return;
    const label = game.i18n.localize(PYRO.atributos[chave]);

    let opts = { bonus: 0, vantagem: 0, desvantagem: 0, nd: null, passarLimites: false };

    if (!rapido) {
      const conteudo = `
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.Bonus")}</label>
          <input type="number" name="bonus" value="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.Vantagem")}</label>
          <input type="number" name="vantagem" value="0" min="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.Desvantagem")}</label>
          <input type="number" name="desvantagem" value="0" min="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.ND")}</label>
          <input type="number" name="nd" placeholder="—"></div>
        ${attr.acimaDoLimite ? `
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.PassarLimites")}</label>
          <input type="checkbox" name="passarLimites"></div>` : ""}`;

      const res = await DialogV2.prompt({
        window: { title: game.i18n.format("PYRO.Teste.Titulo", { atributo: label }) },
        content: conteudo,
        ok: {
          label: game.i18n.localize("PYRO.Rolar"),
          callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
        },
        rejectClose: false
      });
      if (!res) return;
      opts = { ...opts, ...res, nd: res.nd || null };
    }

    // Passar seus Limites: usa o atributo cheio; o corpo sofre um rebote [DEFINIR no SRD].
    const valor = opts.passarLimites ? attr.valor : attr.efetivo;
    const formula = formulaTeste(valor, opts);

    const flavorNd = opts.nd ? ` (ND ${opts.nd})` : "";
    const flavor = game.i18n.format("PYRO.Chat.TesteDe", { atributo: label }) + flavorNd;

    // Pool reduzida a 0 dados por desvantagem: falha automática (SRD §6).
    if (formula === null) {
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor,
        content: `<p class="pyro-falha-auto">${game.i18n.localize("PYRO.Chat.FalhaAutomatica")}</p>`
      });
    }

    const roll = await new Roll(formula).evaluate();
    let content = "";
    if (opts.nd) {
      const sucesso = roll.total >= Number(opts.nd);
      content = `<p class="pyro-resultado ${sucesso ? "sucesso" : "falha"}">
        ${game.i18n.localize(sucesso ? "PYRO.Chat.Sucesso" : "PYRO.Chat.Falha")}</p>`;
    }
    if (opts.passarLimites) {
      content += `<p class="pyro-aviso">${game.i18n.localize("PYRO.Chat.PassouLimites")}</p>`;
    }

    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: content || undefined
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Reações                                                               */
  /* ---------------------------------------------------------------------- */

  /** Dobra a quantidade de dados de uma fórmula ("2d12+1d12" -> "4d12+2d12"). */
  static #dobrarDados(formula) {
    return formula.replace(/(\d+)d(\d+)/g, (m, n, f) => `${Number(n) * 2}d${f}`);
  }

  async rolarEsquiva({ cobertura = false } = {}) {
    // Tomar cobertura dobra os dados rolados (SRD §5).
    let formula = this.system.esquiva;
    if (cobertura) formula = PyroActor.#dobrarDados(formula);
    const roll = await new Roll(expandirAtributos(formula), this.getRollData()).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize(cobertura ? "PYRO.Chat.EsquivaCobertura" : "PYRO.Chat.Esquiva")
    });
  }

  async rolarBloqueio({ cobertura = false } = {}) {
    let formula = this.system.bloqueio;
    if (cobertura) formula = PyroActor.#dobrarDados(formula);
    const roll = await new Roll(expandirAtributos(formula), this.getRollData()).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize(cobertura ? "PYRO.Chat.BloqueioCobertura" : "PYRO.Chat.Bloqueio")
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Força de Vontade                                                      */
  /* ---------------------------------------------------------------------- */

  async gastarVontade(pontos) {
    const v = this.system.recursos.vontade;
    if (v.value < pontos) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
    }
    await this.update({ "system.recursos.vontade.value": v.value - pontos });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p><strong>${game.i18n.localize("PYRO.Vontade.Nome")} (${pontos})</strong>:
        ${game.i18n.localize(`PYRO.Vontade.Uso${pontos}`)}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Estamina (com transbordo pra PV — SRD Recursos)                       */
  /* ---------------------------------------------------------------------- */

  /** Paga um custo de estamina; o que faltar sai dos PV. Retorna o que foi pago. */
  async pagarEstamina(custo) {
    const r = this.system.recursos;
    const daEstamina = Math.min(r.estamina.value, custo);
    const dosPv = custo - daEstamina;
    await this.update({
      "system.recursos.estamina.value": r.estamina.value - daEstamina,
      "system.recursos.pv.value": Math.max(0, r.pv.value - dosPv)
    });
    return { daEstamina, dosPv };
  }

  /**
   * Paga estamina, mana e energia de uma vez (habilidades).
   * Mana e energia não têm transbordo: sem o total, a habilidade não sai.
   * Retorna null se faltar recurso.
   */
  async pagarCustos({ estamina = 0, mana = 0, energia = 0 } = {}) {
    const r = this.system.recursos;
    if (mana > r.mana.value) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemMana", { custo: mana, mana: r.mana.value }));
      return null;
    }
    if (energia > r.energia.value) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemEnergia", { custo: energia, energia: r.energia.value }));
      return null;
    }

    const daEstamina = Math.min(r.estamina.value, estamina);
    const dosPv = estamina - daEstamina;
    await this.update({
      "system.recursos.estamina.value": r.estamina.value - daEstamina,
      "system.recursos.pv.value": Math.max(0, r.pv.value - dosPv),
      "system.recursos.mana.value": r.mana.value - mana,
      "system.recursos.energia.value": r.energia.value - energia
    });
    return { daEstamina, dosPv, mana, energia };
  }

  async tomarAr() {
    const r = this.system.recursos;
    const rec = Math.floor(this.system.atributos.vig.efetivo / 2);
    await this.update({
      "system.recursos.estamina.value": Math.min(r.estamina.max, r.estamina.value + rec)
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("PYRO.Chat.TomarAr", { valor: rec })}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Aplicação de dano e cura (menu do chat)                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Aplica dano descontando a defesa de cada tipo separadamente:
   *   (dano1 - defesa1) + (dano2 - defesa2) ...
   * Cada parcela tem piso 0, então uma defesa alta nunca vira cura.
   * Dano de categoria mental consome Mana em vez de PV (SRD §6).
   *
   * @param {Array<{tipo: string, total: number}>} entradas
   * @param {object} [opcoes]
   * @param {number} [opcoes.multiplicador]  metade (0.5), dobro (2)...
   * @param {boolean} [opcoes.ignorarDefesa] força o valor cheio
   * @param {boolean} [opcoes.mental]        trata tudo como mental
   * @returns {Promise<string>} resumo com a conta feita
   */
  async aplicarDano(entradas, { multiplicador = 1, ignorarDefesa = false, mental = false } = {}) {
    const r = this.system.recursos;
    const totais = this.system.defesas.totais;
    let emPv = 0;
    let emMana = 0;
    const contas = [];

    for (const entrada of entradas) {
      const tipo = mental ? "mental" : entrada.tipo;
      const bruto = Math.floor(entrada.total * multiplicador);
      // Sem tipo conhecido (rolagem avulsa no chat) não há defesa a aplicar.
      const defesa = ignorarDefesa || !tipo ? 0 : (totais[tipo] ?? 0);
      const liquido = Math.max(0, bruto - defesa);

      if (PYRO.tiposDano[tipo]?.categoria === "mental") emMana += liquido;
      else emPv += liquido;

      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      contas.push(defesa
        ? `${rotulo} ${bruto}-${defesa}=${liquido}`
        : `${rotulo} ${liquido}`.trim());
    }

    const pvNovo = Math.max(0, r.pv.value - emPv);
    const manaNovo = Math.max(0, r.mana.value - emMana);
    await this.update({
      "system.recursos.pv.value": pvNovo,
      "system.recursos.mana.value": manaNovo
    });

    const partes = [];
    if (emPv) partes.push(game.i18n.format("PYRO.Chat.AplicouDano", { valor: emPv, pv: pvNovo }));
    if (emMana) partes.push(game.i18n.format("PYRO.Chat.AplicouMental", { valor: emMana }));
    if (!partes.length) partes.push(game.i18n.localize("PYRO.Chat.DefesaAbsorveu"));

    return `${this.name}: ${partes.join(" · ")} (${contas.join(" + ")})`;
  }

  /** Cura PV até o máximo. */
  async aplicarCura(valor) {
    const r = this.system.recursos;
    const novo = Math.min(r.pv.max, r.pv.value + Math.max(0, Math.floor(valor)));
    await this.update({ "system.recursos.pv.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouCura", { valor: novo - r.pv.value, pv: novo })}`;
  }

  /** Devolve estamina (efeitos de fôlego, itens). */
  async aplicarEstamina(valor) {
    const r = this.system.recursos;
    const novo = Math.clamp(r.estamina.value + Math.floor(valor), 0, r.estamina.max);
    await this.update({ "system.recursos.estamina.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouEstamina", { valor: novo - r.estamina.value })}`;
  }

  /* ---------------------------------------------------------------------- */
  /*  Recuperação por passagem de tempo                                     */
  /* ---------------------------------------------------------------------- */

  /** Recursos personalizados que este personagem tem acesso. */
  #recursosExtras() {
    return (this.system.recursosConcedidos ?? []).filter(c => this.system.recursos[c]);
  }

  /** Início de cena: estamina cheia, +VIG de PV, +recuperação de mana. */
  async recuperarCena() {
    const r = this.system.recursos;
    const a = this.system.atributos;
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      const rec = r[chave];
      extras[`system.recursos.${chave}.value`] =
        Math.min(rec.max, rec.value + (rec.recuperacao ?? 0));
    }
    await this.update({
      ...extras,
      "system.recursos.estamina.value": r.estamina.max,
      "system.recursos.pv.value": Math.min(r.pv.max, r.pv.value + a.vig.efetivo),
      "system.recursos.mana.value": Math.min(r.mana.max, r.mana.value + r.mana.recuperacao),
      "system.recursos.energia.value": Math.min(r.energia.max, r.energia.value + r.energia.recuperacao)
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovaCena")}</p>`
    });
  }

  /** Início de capítulo: vida e mana completas. */
  async recuperarCapitulo() {
    const r = this.system.recursos;
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      extras[`system.recursos.${chave}.value`] = r[chave].max;
    }
    await this.update({
      ...extras,
      "system.recursos.pv.value": r.pv.max,
      "system.recursos.mana.value": r.mana.max,
      "system.recursos.energia.value": r.energia.max,
      "system.recursos.estamina.value": r.estamina.max
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoCapitulo")}</p>`
    });
  }

  /** Início de arco (ou subida de DET): Força de Vontade reseta. */
  async recuperarArco() {
    await this.recuperarCapitulo();
    await this.update({
      "system.recursos.vontade.value": this.system.recursos.vontade.max
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoArco")}</p>`
    });
  }
}
