import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch();
try{
 const context=await browser.newContext();const page=await context.newPage();await page.goto('http://localhost:5173');await page.getByRole('heading').first().waitFor();
 console.log(JSON.stringify(await page.locator('.step-circle').evaluateAll(nodes=>nodes.map(n=>({class:n.className,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})))));
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 console.log(JSON.stringify(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),null,2));
}finally{await browser.close();}
