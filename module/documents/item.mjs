import { PYRO } from "../config.mjs";
import { conjurarMagiaSalva, scalingsPadrao } from "../magia.mjs";
import { formulaTeste, expandirAtributos } from "../dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, ajustesDeAtributo, ajustesDeCusto, custoAjustado
} from "../efeitos.mjs";
import { formulaPool } from "../dados.mjs";
import { proximaOrdem, idDoCaminho } from "../data/item-data.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Distância em metros entre o token do ator e o alvo marcado (se houver).
 * Retorna null quando não dá pra medir (sem token ou sem alvo).
 */
export function distanciaAteAlvo(actor) {
  try {
    const origem = actor?.getActiveTokens(true)[0];
    const alvo = game.user.targets.first();
    if (!origem || !alvo || origem === alvo) return null;
    const medida = canvas.grid.measurePath([origem.center, alvo.center]);
    return Math.round(medida.distance);
  } catch (e) {
    console.warn("PYRO | Não foi possível medir a distância até o alvo", e);
    return null;
  }
}

/** Nome automático de um caminho: "Caminho do <raça ou profissão>". */
export function nomeDoCaminho(sys) {
  let base;
  if (sys.ehRacial) {
    const preset = PYRO.racas[sys.raca];
    base = preset
      ? game.i18n.format(preset.nome, { detalhe: sys.racaDetalhe || game.i18n.localize("PYRO.Item.SemDetalhe") })
      : (sys.racaDetalhe || "");
  } else {
    base = sys.nomeCaminho || "";
  }
  base = base.trim();
  if (!base) base = game.i18n.localize("PYRO.Item.SemDetalhe");
  return game.i18n.format("PYRO.CaminhoNome", { nome: base });
}

/** Nome automático de uma runa: a palavra/gesto, ou o tipo como reserva. */
export function nomeDaRuna(sys) {
  const palavra = (sys.palavra ?? "").trim();
  if (palavra) return palavra;
  if (sys.tipoRuna === "elemento") {
    const cfg = PYRO.elementos[sys.subtipo];
    if (cfg) return game.i18n.localize(cfg.label);
  }
  return game.i18n.localize(PYRO.tiposRuna[sys.tipoRuna] ?? "TYPES.Item.runa");
}

export class PyroItem extends Item {
  /** Efeitos marcados como "de uso": vão para o alvo, não para quem carrega. */
  get efeitosDeUso() {
    return this.effects.filter(e => e.flags?.pyro?.deUso && !e.disabled);
  }

  /** Bloco de botões de efeito de uso no card do chat. */
  #efeitosHTML() {
    return htmlEfeitosDeUso(this);
  }

  /** Cabeçalho padrão dos cards do chat: ícone, nome e linha de contexto. */
  #topoHTML(meta) {
    const esc = Handlebars.escapeExpression;
    return `<header class="pyro-item-topo">
      <img src="${this.img}" alt="" />
      <div>
        <h3>${esc(this.name)}</h3>
        ${meta ? `<span class="pyro-item-meta">${meta}</span>` : ""}
      </div>
    </header>`;
  }

  /** Runas criadas num ator nascem na língua nativa dele (elfo -> élfica). */
  async _preCreate(data, options, user) {
    const permitido = await super._preCreate(data, options, user);
    if (permitido === false) return false;
    if (this.type === "runa" && this.actor) {
      const alteracoes = {};
      if (!data.system?.lingua) {
        alteracoes["system.lingua"] = this.actor.system.linguaNativa ?? "humana";
      }
      // Nasce já num elemento que o personagem tem afinidade, não no fogo fixo.
      const afinidades = this.actor.system.afinidadesElementos ?? [];
      if (!data.system?.subtipo && afinidades.length && !afinidades.includes(this.system.subtipo)) {
        alteracoes["system.subtipo"] = afinidades[0];
      }
      if (!foundry.utils.isEmpty(alteracoes)) this.updateSource(alteracoes);
      // Sem palavra ainda, o nome vira o elemento ("Raio") em vez de "Runa".
      if (!data.system?.palavra) this.updateSource({ name: nomeDaRuna(this.system) });
      // Já nasce com o que as regras dão para aquele elemento ou gesto.
      if (!data.system?.scalings?.length) {
        this.updateSource({ "system.scalings": scalingsPadrao(this) });
      }
      // Elementos de Subjulgar (Morte) nascem com o modo ligado.
      if (data.system?.subjulgar === undefined && this.system.tipoRuna === "elemento"
        && PYRO.elementos[this.system.subtipo]?.subjulgar) {
        this.updateSource({ "system.subjulgar": true });
      }
    }
    /*
     * Habilidade nova ocupa a primeira vaga livre da fila daquele caminho, e
     * é a vaga que fixa o custo. Uma vaga que já venha no dado (duplicar uma
     * habilidade, arrastar de outra ficha) é respeitada quando está livre —
     * senão duas habilidades dividiriam a mesma vaga e o mesmo custo.
     */
    if (this.type === "habilidade" && this.actor) {
      this.updateSource({
        "system.ordem": this.system.ehBase ? 0 : proximaOrdem(this.actor, this.system.caminho, {
          preferida: data.system?.ordem
        })
      });
    }
    if (this.type === "caminho") {
      if (!data.name?.trim()) this.updateSource({ name: nomeDoCaminho(this.system) });
      // Caminho vindo de compêndio ou duplicado pode trazer tamanho fora da
      // faixa da raça: encaixa já na criação.
      if (this.system.ehRacial) {
        const ajustado = PYRO.tamanhoNaFaixa(this.system.raca, this.system.tamanho);
        if (ajustado !== this.system.tamanho) this.updateSource({ "system.tamanho": ajustado });
      }
    }
    if (this.type === "runa" && data.system?.palavra) {
      this.updateSource({ name: nomeDaRuna(this.system) });
    }
  }

  /** Caminho novo num ator já nasce com a habilidade base dele. */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    // Só o cliente que criou monta a habilidade, senão duplica.
    if (userId !== game.user.id || this.type !== "caminho" || !this.actor) return;
    await Item.implementation.create({
      name: game.i18n.localize("PYRO.Item.HabilidadeBase"),
      type: "habilidade",
      system: { caminho: this.id, tier: 1, ordem: 0, ehBase: true }
    }, { parent: this.actor });
  }

  /**
   * Habilidade apagada solta quem a usava como base. Sem isto, a vaga ficaria
   * ocupada por uma referência morta e a habilidade de cima continuaria dizendo
   * que veio de algo que não existe mais.
   */
  async _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (userId !== game.user.id || this.type !== "habilidade" || !this.actor) return;

    const dependentes = this.actor.items.filter(i =>
      i.type === "habilidade" && (i.system.requisitos ?? []).some(r => r.id === this.id));
    if (!dependentes.length) return;

    await this.actor.updateEmbeddedDocuments("Item", dependentes.map(i => ({
      _id: i.id,
      "system.requisitos": i.system.toObject().requisitos.filter(r => r.id !== this.id)
    })));
  }

  /**
   * Caminhos têm nome derivado (raça/profissão) e, ao trocar de raça,
   * herdam o preset de potencial mágico e as marcações de magia/feitiçaria.
   */
  async _preUpdate(changed, options, user) {
    const permitido = await super._preUpdate(changed, options, user);
    if (permitido === false) return false;

    const s = changed.system ?? {};

    // Runa: o nome acompanha a palavra/gesto.
    if (this.type === "runa" && ("palavra" in s || "tipoRuna" in s || "subtipo" in s)) {
      const projecao = foundry.utils.mergeObject(this.system.toObject(), s, { inplace: false });
      changed.name = nomeDaRuna(projecao);
      /*
       * Trocar o elemento ou o tipo troca o que a runa produz: os
       * escalonamentos voltam ao padrão do novo elemento/gesto. A comparação
       * é com o valor salvo porque o formulário reenvia os escalonamentos
       * antigos junto da troca — e eles pertencem ao elemento anterior.
       * O modo Subjulgar também segue o padrão do elemento novo.
       */
      const mudouNatureza = ("tipoRuna" in s && s.tipoRuna !== this.system.tipoRuna)
        || ("subtipo" in s && s.subtipo !== this.system.subtipo);
      if (mudouNatureza) {
        const projetado = { type: "runa", system: projecao };
        s.scalings = scalingsPadrao(projetado);
        s.subjulgar = !!(projecao.tipoRuna === "elemento"
          && PYRO.elementos[projecao.subtipo]?.subjulgar);
        changed.system = s;
      }
    }

    /*
     * Arma à distância: o alcance máximo nunca fica abaixo do menor. Máximo
     * zero é corpo a corpo, e aí o menor é o alcance da arma (um bastão chega
     * a 1m) — a correção não vale para esse caso, senão toda arma de mão
     * viraria arma de arremesso ao ser editada.
     */
    if (this.type === "arma" && ("alcanceMenor" in s || "alcanceMaximo" in s)) {
      const menor = s.alcanceMenor ?? this.system.alcanceMenor;
      const maximo = s.alcanceMaximo ?? this.system.alcanceMaximo;
      if (maximo > 0 && menor > maximo) s.alcanceMaximo = menor + 1;
      changed.system = s;
    }

    /*
     * Baixar o tier reduz os pontos de aumento: o excesso é aparado do fim
     * para o começo, para a habilidade nunca dar mais do que concede.
     */
    if (this.type === "habilidade" && "tier" in s && !("aumentos" in s)) {
      const teto = Math.max(0, s.tier - 1);
      const atuais = this.system.toObject().aumentos ?? [];
      let gasto = atuais.reduce((t, a) => t + a.pontos, 0);
      if (gasto > teto) {
        const podados = [];
        for (const a of atuais) {
          const cabe = Math.min(a.pontos, Math.max(0, teto - podados.reduce((t, x) => t + x.pontos, 0)));
          if (cabe > 0) podados.push({ ...a, pontos: cabe });
        }
        s.aumentos = podados;
        changed.system = s;
      }
    }

    /*
     * Pré-requisitos só valem enquanto apontam para habilidades que existem,
     * estão no tier imediatamente abaixo e respeitam a regra de caminho: o
     * tier 2 funde dentro do próprio caminho, o tier 3 pode misturar.
     *
     * Subir o tier de 2 para 3 derruba as bases antigas, que agora estão dois
     * degraus abaixo, e trocar o caminho de uma tier 2 derruba as que ficaram
     * do lado de fora. Melhor perder a ligação do que guardar uma que a árvore
     * não saberia desenhar.
     *
     * A habilidade base do caminho não entra nessa contabilidade: ela não é
     * ingrediente de ninguém, e não precisa de ingredientes para subir de tier.
     */
    if (this.type === "habilidade" && this.actor) {
      const tier = s.tier ?? this.system.tier;
      const ehBase = s.ehBase ?? this.system.ehBase;
      const caminho = idDoCaminho(this.actor, s.caminho ?? this.system.caminho);
      const lista = s.requisitos ?? this.system.requisitos ?? [];
      const validos = (tier >= 2 && !ehBase)
        ? lista.filter(r => {
            const base = this.actor.items.get(r.id);
            if (base?.system.tier !== tier - 1 || base.system.ehBase) return false;
            return tier >= 3 || idDoCaminho(this.actor, base.system.caminho) === caminho;
          })
        : [];
      if (validos.length !== lista.length) {
        s.requisitos = validos.map(r => ({ id: r.id, nome: r.nome }));
        changed.system = s;
      }
    }

    /*
     * Trocar de caminho (ou marcar como base) refaz a vaga na fila. A vaga
     * atual é mantida quando está livre no caminho novo, então mover uma
     * habilidade de lugar não encarece ela sem motivo. Vaga digitada à mão
     * pelo jogador tem prioridade e passa direto.
     */
    if (this.type === "habilidade" && ("caminho" in s || "ehBase" in s)) {
      const ehBase = s.ehBase ?? this.system.ehBase;
      // A ficha reenvia o formulário inteiro a cada mudança, então "ordem"
      // chega junto mesmo quando o jogador só trocou o caminho. Só conta como
      // escolha dele quando o número de fato mudou.
      const digitada = "ordem" in s && s.ordem !== this.system.ordem;
      if (ehBase) s.ordem = 0;
      else if (!digitada) {
        s.ordem = proximaOrdem(this.actor, s.caminho ?? this.system.caminho, {
          excluirId: this.id,
          preferida: this.system.ordem
        });
      }
      changed.system = s;
    }

    if (this.type !== "caminho") return;

    const sys = s;
    if (sys.raca && sys.raca !== this.system.raca) {
      const preset = PYRO.racas[sys.raca];
      if (preset) {
        sys.potencial = preset.potencial;
        sys.recursos = [...(preset.recursos ?? [])];
        if (preset.custom) {
          // Raça aberta: o jogador decide nas checkboxes.
          sys.usaMagia ??= preset.magia;
          sys.usaFeiticaria ??= preset.feiticos;
        } else {
          // Raça fechada: o preset manda (as checkboxes ficam ocultas).
          sys.usaMagia = preset.magia;
          sys.usaFeiticaria = preset.feiticos;
        }
        changed.system = sys;
      }
    }

    /*
     * O tamanho fica dentro da faixa da raça. Trocar um Demi-Humano gigante
     * para Humano puxa o valor para Médio, em vez de deixar gravado um tamanho
     * que o dropdown nem oferece mais. Vale também para ficha antiga, que se
     * corrige na primeira edição.
     */
    const ehRacial = sys.ehRacial ?? this.system.ehRacial;
    if (ehRacial) {
      const raca = sys.raca ?? this.system.raca;
      const tamanho = sys.tamanho ?? this.system.tamanho;
      const ajustado = PYRO.tamanhoNaFaixa(raca, tamanho);
      if (ajustado !== tamanho) {
        sys.tamanho = ajustado;
        changed.system = sys;
      }
    }

    // Recalcula sempre: assim o nome também se corrige quando o mestre muda
    // o padrão da raça nas configurações do mundo.
    if (changed.name === undefined) {
      const projecao = foundry.utils.mergeObject(this.system.toObject(), sys, { inplace: false });
      changed.name = nomeDoCaminho(projecao);
    }
  }

  /**
   * Dados de rolagem deste item. Sobre o que o ator já oferece, entram os
   * aumentos de atributo dos efeitos presos a este item — eles ficam de fora
   * da ficha justamente para valerem só aqui.
   */
  getRollData() {
    const dados = this.actor?.getRollData() ?? {};
    for (const [chave, delta] of Object.entries(ajustesDeAtributo(this.actor, this))) {
      if (typeof dados[chave] !== "number") continue;
      dados[chave] += delta;
      // A pool acompanha, senão "@dados.for" continuaria na linha antiga.
      if (dados.dados) dados.dados[chave] = formulaPool(dados[chave]);
    }
    return dados;
  }

  /**
   * Rolagens de dano que os efeitos somam a este item, já renderizadas.
   * Cada bônus entra como parcela própria, com tipo, para o desconto de
   * defesa no chat continuar batendo tipo a tipo.
   */
  async #bonusDeDanoHTML(tipoPadrao) {
    const esc = Handlebars.escapeExpression;
    const partes = [];
    const danos = [];
    const rolls = [];

    for (const bonus of bonusDeDano(this.actor, this)) {
      const roll = await new Roll(expandirAtributos(bonus.formula), this.getRollData()).evaluate();
      rolls.push(roll);
      // Sem tipo escolhido, o bônus herda o tipo do ataque que ele acompanha.
      const tipo = bonus.tipo || tipoPadrao || "";
      danos.push({ tipo, total: roll.total });
      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      partes.push(
        `<p class="pyro-linha-dano dano-${tipo}">${esc(bonus.nome)}${rotulo ? ` — ${rotulo}` : ""}</p>`,
        await roll.render()
      );
    }
    return { partes, danos, rolls };
  }

  /** Ponto de entrada único de "usar" um item — a ficha chama isso. */
  async usar() {
    switch (this.type) {
      case "arma": return this.#atacar();
      case "consumivel": return this.#consumir();
      case "habilidade": return this.#usarHabilidade();
      case "feitico": return this.#usarFeitico();
      case "magia": return conjurarMagiaSalva(this.actor, this);
      default: return this.#postar();
    }
  }

  /* ---------------------------------------------------------------------- */

  async #atacar() {
    const s = this.system;
    const actor = this.actor;
    const speaker = ChatMessage.getSpeaker({ actor });

    /* --- Munição: escolhe agora, desconta depois da mira ------------------ */
    let municao = null;
    if (s.usaMunicao && actor) {
      const opcoes = actor.items.filter(i =>
        i.type === "consumivel" && i.system.municao && i.system.quantidade > 0
      );
      if (!opcoes.length) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemMunicao"));
      }
      const selects = opcoes.map(m =>
        `<option value="${m.id}">${Handlebars.escapeExpression(m.name)} (x${m.system.quantidade})</option>`
      ).join("");
      const res = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("PYRO.Municao.Titulo") },
        content: `<div class="form-group">
          <label>${game.i18n.localize("TYPES.Item.consumivel")}</label>
          <select name="municao">${selects}</select>
        </div>`,
        ok: {
          label: game.i18n.localize("PYRO.Rolar"),
          callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
        },
        rejectClose: false
      });
      if (!res) return;
      municao = actor.items.get(res.municao);
      if (!municao) return;
      // O desconto acontece só depois do teste de mira, pra não gastar
      // munição quando o ataque é cancelado.
    }

    /* --- Teste de mira (armas de 3m ou mais) -------------------------------- */
    const rolls = [];
    let mira = null;
    if (s.alcanceMaximo >= 3) {
      mira = await this.#testeDeMira();
      if (mira === null) return; // cancelado: nada é gasto
      rolls.push(mira.roll);
    }

    // Munição some ao disparar, acertando ou errando.
    if (municao) await municao.update({ "system.quantidade": municao.system.quantidade - 1 });

    const alcanceTexto = s.alcanceMaximo > 0
      ? `${s.alcanceMenor}/${s.alcanceMaximo}m` : `${s.alcanceMenor}m`;
    // Efeito de custo pode baratear ou encarecer o ataque em ações.
    const acoes = custoAjustado(s.acoes, ajustesDeCusto(actor, this).acoes);
    const detalhes = [
      game.i18n.format("PYRO.Chat.CustoAcoes", { acoes }),
      alcanceTexto
    ].filter(Boolean).join(" · ");
    const partes = [this.#topoHTML(detalhes)];

    if (mira) {
      partes.push(`<div class="pyro-mira ${mira.acertou ? "sucesso" : "falha"}">
        <p>${game.i18n.format("PYRO.Mira.Resultado", { distancia: mira.distancia, nd: mira.nd })}
          — <strong><i class="fa-solid ${mira.acertou ? "fa-check" : "fa-xmark"}"></i>
          ${game.i18n.localize(mira.acertou ? "PYRO.Mira.Acertou" : "PYRO.Mira.Errou")}</strong></p>
        ${await mira.roll.render()}
      </div>`);
      if (!mira.acertou) {
        if (municao) {
          partes.push(`<p class="pyro-nota">${game.i18n.format("PYRO.Municao.Usou", { nome: Handlebars.escapeExpression(municao.name) })}</p>`);
        }
        return ChatMessage.create({
          speaker,
          content: `<div class="pyro-chat">${partes.join("")}</div>`,
          rolls,
          sound: CONFIG.sounds.dice
        });
      }
    }

    // Cada entrada de dano rola separado, com seu próprio tipo — o menu do
    // chat precisa disso pra descontar a defesa certa de cada parcela.
    const danos = [];
    for (const d of s.danos ?? []) {
      if (!d.formula?.trim()) continue;
      const roll = await new Roll(expandirAtributos(d.formula), this.getRollData()).evaluate();
      rolls.push(roll);
      danos.push({ tipo: d.tipo, total: roll.total });
      const tipo = game.i18n.localize(PYRO.tiposDano[d.tipo]?.label ?? d.tipo ?? "");
      partes.push(`<p class="pyro-linha-dano dano-${d.tipo}">${tipo}</p>`, await roll.render());
    }

    // Bônus de efeito ("Maestria com Katana: 2d6") entram como parcelas extras.
    const bonus = await this.#bonusDeDanoHTML(s.danos?.[0]?.tipo);
    partes.push(...bonus.partes);
    danos.push(...bonus.danos);
    rolls.push(...bonus.rolls);

    if (municao) {
      partes.push(`<p class="pyro-nota">${game.i18n.format("PYRO.Municao.Usou", { nome: Handlebars.escapeExpression(municao.name) })}</p>`);
      // Munição com fórmula (ex.: Flechas de Raio) rola o dano adicional.
      if (municao.system.formula) {
        const extra = await new Roll(expandirAtributos(municao.system.formula), this.getRollData()).evaluate();
        rolls.push(extra);
        danos.push({ tipo: municao.system.tipoDano, total: extra.total });
        const tipoMun = game.i18n.localize(PYRO.tiposDano[municao.system.tipoDano]?.label ?? "");
        partes.push(`<p><strong>${Handlebars.escapeExpression(municao.name)}</strong> — ${game.i18n.localize("PYRO.Municao.DanoExtra")}${tipoMun ? ` (${tipoMun})` : ""}</p>`, await extra.render());
      }
    }

    partes.push(this.#efeitosHTML());

    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">${partes.join("")}</div>`,
      rolls,
      // O menu do chat usa estas flags: dano separado por tipo, sem o teste de mira.
      flags: { pyro: { danos, cura: 0 } },
      sound: CONFIG.sounds.dice
    });
  }

  /**
   * Janela do teste de mira: DES contra ND igual à distância em metros.
   * Com um alvo marcado, a distância e o ND já vêm preenchidos, e passar do
   * alcance menor soma uma desvantagem automaticamente (SRD §5).
   */
  async #testeDeMira() {
    const s = this.system;
    const actor = this.actor;
    const medida = distanciaAteAlvo(actor);
    const distancia = medida ?? Math.max(3, s.alcanceMenor || 3);
    const desvInicial = distancia > s.alcanceMenor ? 1 : 0;

    const dica = medida !== null
      ? game.i18n.format("PYRO.Mira.AlvoMarcado", { distancia: medida })
      : game.i18n.localize("PYRO.Mira.SemAlvo");

    const res = await DialogV2.prompt({
      window: { title: game.i18n.localize("PYRO.Mira.Titulo") },
      content: `
        <p class="hint">${dica}</p>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Mira.Distancia")}</label>
          <input type="number" name="distancia" value="${distancia}" min="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.ND")}</label>
          <input type="number" name="nd" value="${distancia}" min="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.Vantagem")}</label>
          <input type="number" name="vantagem" value="0" min="0"></div>
        <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.Desvantagem")}</label>
          <input type="number" name="desvantagem" value="${desvInicial}" min="0"></div>
        <p class="hint">${game.i18n.localize("PYRO.Mira.Dica")}</p>`,
      ok: {
        label: game.i18n.localize("PYRO.Rolar"),
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      },
      rejectClose: false
    });
    if (!res) return null;

    const des = actor?.system.atributos.des;
    const formula = des ? formulaTeste(des.efetivo, {
      vantagem: Number(res.vantagem) || 0,
      desvantagem: Number(res.desvantagem) || 0
    }) : null;

    // Pool zerada por desvantagens: erra sem rolar (mesma regra dos testes).
    const roll = await new Roll(formula ?? "0").evaluate();
    const nd = Number(res.nd) || 0;
    return {
      roll,
      nd,
      distancia: Number(res.distancia) || 0,
      acertou: formula !== null && roll.total >= nd
    };
  }

  async #consumir() {
    const s = this.system;
    if (s.quantidade < 1) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemQuantidade"));
    }
    await this.update({ "system.quantidade": s.quantidade - 1 });

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    if (!s.formula) return this.#postar();
    const roll = await new Roll(expandirAtributos(s.formula), this.getRollData()).evaluate();
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(game.i18n.format("PYRO.Chat.CustoAcoes", {
          acoes: custoAjustado(s.acoes, ajustesDeCusto(this.actor, this).acoes)
        }))}
        ${await roll.render()}
        ${this.#efeitosHTML()}
      </div>`,
      rolls: [roll],
      // O rodapé do card decide: o valor pode virar cura ou estamina.
      flags: { pyro: { danos: [], cura: roll.total } },
      sound: CONFIG.sounds.dice
    });
  }

  async #usarHabilidade() {
    const s = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });

    /*
     * Custos já ajustados pelos efeitos: um "Conjuração Econômica: -2 mana"
     * desconta antes de cobrar, e não só no texto do card. Piso zero, para
     * um desconto grande não virar ganho de recurso.
     */
    const ajustes = ajustesDeCusto(this.actor, this);
    const cobra = {
      estamina: custoAjustado(s.custoEstamina, ajustes.estamina),
      mana: custoAjustado(s.custoMana, ajustes.mana),
      energia: custoAjustado(s.custoEnergia, ajustes.energia)
    };
    const custoAcoes = custoAjustado(s.custoAcoes, ajustes.acoes);

    const custos = [];
    if (this.actor && (cobra.estamina || cobra.mana || cobra.energia)) {
      const pago = await this.actor.pagarCustos(cobra);
      if (!pago) return; // faltou mana ou energia
      if (pago.daEstamina) custos.push(game.i18n.format("PYRO.Chat.CustoEstamina", { valor: pago.daEstamina }));
      // Sem estamina suficiente, o resto sai dos PV (SRD Recursos).
      if (pago.dosPv) custos.push(game.i18n.format("PYRO.Chat.CustoPv", { valor: pago.dosPv }));
      if (pago.mana) custos.push(game.i18n.format("PYRO.Chat.CustoManaHab", { valor: pago.mana }));
      if (pago.energia) custos.push(game.i18n.format("PYRO.Chat.CustoEnergia", { valor: pago.energia }));
    }

    const chaveCusto = s.tipoCusto === "reacao" ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes";
    const cab = [
      custoAcoes ? game.i18n.format(chaveCusto, { acoes: custoAcoes }) : null,
      ...custos
    ].filter(Boolean).join(" · ");

    if (s.formula) {
      const roll = await new Roll(expandirAtributos(s.formula), this.getRollData()).evaluate();
      return ChatMessage.create({
        speaker,
        content: `<div class="pyro-chat">
          ${this.#topoHTML(cab)}
          ${await roll.render()}
          ${this.#efeitosHTML()}
        </div>`,
        rolls: [roll],
        // Sem tipo definido: o rodapé oferece dano (sem defesa), cura e estamina.
        flags: { pyro: { danos: [{ tipo: "", total: roll.total }], cura: roll.total } },
        sound: CONFIG.sounds.dice
      });
    }
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(cab)}
        ${this.system.descricao ?? ""}
        ${this.#efeitosHTML()}
      </div>`
    });
  }

  async #usarFeitico() {
    const s = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const cab = s.custoAcoes
      ? game.i18n.format("PYRO.Chat.CustoAcoes", {
          acoes: custoAjustado(s.custoAcoes, ajustesDeCusto(this.actor, this).acoes)
        }) : "";

    if (s.formula) {
      const roll = await new Roll(expandirAtributos(s.formula), this.getRollData()).evaluate();
      return ChatMessage.create({
        speaker,
        content: `<div class="pyro-chat">
          ${this.#topoHTML(cab)}
          ${await roll.render()}
          ${this.#efeitosHTML()}
        </div>`,
        rolls: [roll],
        flags: { pyro: { danos: [{ tipo: "", total: roll.total }], cura: roll.total } },
        sound: CONFIG.sounds.dice
      });
    }
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(cab)}
        ${s.descricao ?? ""}
        ${this.#efeitosHTML()}
      </div>`
    });
  }

  /** Card de consulta no chat: nome, resumo mecânico e descrição. */
  async mostrarNoChat() {
    const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const descricao = await enrich(this.system.descricao ?? "", {
      relativeTo: this, secrets: this.isOwner
    });
    const esc = Handlebars.escapeExpression;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pyro-chat pyro-item-card">
        <header class="pyro-item-topo">
          <img src="${this.img}" alt="" />
          <div>
            <h3>${esc(this.name)}</h3>
            <span class="pyro-item-tipo">${game.i18n.localize(`TYPES.Item.${this.type}`)}</span>
          </div>
        </header>
        ${descricao || `<p class="pyro-nota">${game.i18n.localize("PYRO.SemDescricao")}</p>`}
        ${this.#efeitosHTML()}
      </div>`
    });
  }

  async #postar() {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pyro-chat">
        ${this.#topoHTML(game.i18n.localize(`TYPES.Item.${this.type}`))}
        ${this.system.descricao || ""}
      </div>`
    });
  }
}
