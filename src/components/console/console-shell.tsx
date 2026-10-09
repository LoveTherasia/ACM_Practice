"use client";

import { Code, Dashboard, Home, Settings } from "@carbon/icons-react";
import {
  Content,
  Header,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  HeaderSideNavItems,
  SideNav,
  SideNavItems,
  SideNavLink,
} from "@carbon/react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The console application shell.
 *
 * Carbon UIShell owns the skip link, the header and the side nav. Describing
 * them once here instead of per page is the reason to reach for an official
 * design system in the first place (taste-skill Section 2.A).
 */

const REGISTRY_HREF = "/console";
const GENERATE_HREF = "/console/generate";
const SETTINGS_HREF = "/console/settings";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sideNavExpanded, setSideNavExpanded] = useState(false);

  const registryActive =
    pathname === REGISTRY_HREF || pathname.startsWith("/console/problems");
  const generateActive =
    pathname === GENERATE_HREF || pathname.startsWith(`${GENERATE_HREF}/`);
  const settingsActive =
    pathname === SETTINGS_HREF || pathname.startsWith(`${SETTINGS_HREF}/`);

  return (
    <>
      <Header aria-label="ACM Practice 控制台">
        <HeaderMenuButton
          aria-label={sideNavExpanded ? "关闭导航" : "打开导航"}
          isActive={sideNavExpanded}
          onClick={() => setSideNavExpanded((expanded) => !expanded)}
        />
        <HeaderName href={REGISTRY_HREF} prefix="ACM Practice">
          出题控制台
        </HeaderName>
        <HeaderNavigation aria-label="控制台导航">
          {/* HeaderMenuItem renders an <a> itself; nesting Carbon's Link
              (also an <a>) inside it produces <a><a>, which is invalid HTML
              and a hydration error. Pass href directly instead. */}
          <HeaderMenuItem href={REGISTRY_HREF} isActive={registryActive}>
            题目库
          </HeaderMenuItem>
          <HeaderMenuItem href={GENERATE_HREF} isActive={generateActive}>
            造题
          </HeaderMenuItem>
          <HeaderMenuItem href={SETTINGS_HREF} isActive={settingsActive}>
            模型配置
          </HeaderMenuItem>
        </HeaderNavigation>
        <HeaderGlobalBar>
          <ThemeToggle />
          {/* A plain button rather than HeaderGlobalAction: the Carbon
              action wraps children in a Tooltip whose useId() differs
              between server and client render, tripping hydration. */}
          <button
            type="button"
            aria-label="返回首页"
            title="返回首页"
            onClick={() => window.location.assign("/")}
            className="cds--header__action inline-flex h-11 w-11 items-center justify-center border-0 bg-transparent text-[var(--cds-text-primary,#161616)] transition-colors duration-300 hover:bg-[var(--cds-background-hover,#e8e8e8)] focus-ring"
          >
            <Home size={20} />
          </button>
        </HeaderGlobalBar>
      </Header>

      <SideNav
        aria-label="控制台导航"
        expanded={sideNavExpanded}
        isPersistent={false}
        onOverlayClick={() => setSideNavExpanded(false)}
      >
        <SideNavItems>
          <HeaderSideNavItems>
            <SideNavLink
              href={REGISTRY_HREF}
              isActive={registryActive}
              renderIcon={Dashboard}
              onClick={() => setSideNavExpanded(false)}
            >
              题目库
            </SideNavLink>
            <SideNavLink
              href={GENERATE_HREF}
              isActive={generateActive}
              renderIcon={Code}
              onClick={() => setSideNavExpanded(false)}
            >
              造题
            </SideNavLink>
            <SideNavLink
              href={SETTINGS_HREF}
              isActive={settingsActive}
              renderIcon={Settings}
              onClick={() => setSideNavExpanded(false)}
            >
              模型配置
            </SideNavLink>
          </HeaderSideNavItems>
        </SideNavItems>
      </SideNav>

      <Content id="main" className="cds--content">
        {children}
      </Content>
    </>
  );
}